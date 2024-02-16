import {
  PageSizes,
  PDFName,
  PDFString,
  PDFDocument,
  StandardFonts,
  rgb,
  degrees
} from 'pdf-lib'

const VALUE_PATTERN = '\\$\\.[a-zA-Z0-9_.]+'
const VALUES = new RegExp(VALUE_PATTERN, 'g')

export async function createPdf({
  stackName,
  template,
  data,
  images = [],
  correlationIds = {}
}) {
  data = {
    ...data,
    page: 0,
    pageTotal: 0,
    countPages: true
  }

  const pdfDoc = await PDFDocument.create()

  const builder = {
    pdfDoc,
    fonts: await embedFonts({ pdfDoc, fonts: template.fonts }),
    images: await embedImages({ pdfDoc, images }),
    template,
    data
  }

  // create two times, first time to count pages only :)

  for (const i of Array.from({ length: 2 }).keys()) {
    if (i === 1) {
      data.countPages = false
      data.page = 0
    }
    builder.layout = [
      ...template.pageNumberHeader,
      ...template.header,
      ...template.details,
      ...template.footer
    ].filter(Boolean)
    builder.links = []

    await drawLayout(builder)

    if (i === 0) {
      while (pdfDoc.getPageCount() > 0) {
        pdfDoc.removePage(0)
      }
    }
  }

  pdfDoc.setTitle(getValue({ value: template.title, data }), {
    showInWindowTitleBar: true
  })
  pdfDoc.setSubject(getValue({ value: template.subject, data }))
  pdfDoc.setLanguage(template.language)
  pdfDoc.setProducer(`${stackName} 🤖`)
  pdfDoc.setKeywords(Object.entries(correlationIds).flat())
  pdfDoc.setCreator('pdf-lib (https://github.com/Hopding/pdf-lib)')
  pdfDoc.setCreationDate(new Date())
  pdfDoc.setModificationDate(new Date())

  return pdfDoc
}

async function drawOperations({ builder, operations }) {
  const { template, data, images, fonts, links } = builder
  let { page } = builder

  let maxHeight = 0
  for (const operation of operations) {
    switch (operation.type) {
      case 'move': {
        for (const direction of ['Up', 'Down', 'Right', 'Left']) {
          const n = operation[direction.toLowerCase()]
          if (typeof n === 'number') {
            page[`move${direction}`](n)
          }
        }

        break
      }
      case 'position': {
        if (operation.y && page.getY() < operation.y) {
          page = await createNextPage(builder)
        }
        page.moveTo(operation.x ?? page.getX(), operation.y ?? page.getY())

        break
      }
      case 'image': {
        const image = images[operation.name]
        const { width, height } =
          operation.width ?? image.scale(operation.scale ?? 1)
        page.drawImage(image, {
          width,
          height,
          y: page.getY() - height,
          ...(operation.opacity && { opacity: operation.opacity })
        })
        maxHeight = Math.max(maxHeight, height)
        page.moveRight(width)

        break
      }
      case 'table': {
        for await (const {
          i,
          rows,
          tableHeight,
          tableWidth,
          page
        } of wrapTable({
          operation,
          builder
        })) {
          page.drawSvgPath(
            `M0,0 h${tableWidth} a2.5,2.5 0 0 1 2.5,2.5 v${tableHeight} a2.5,2.5 0 0 1 -2.5,2.5 h-${tableWidth} a2.5,2.5 0 0 1 -2.5,-2.5 v-${tableHeight} a2.5,2.5 0 0 1 2.5,-2.5 z`,
            {
              x: template.margin,
              borderWidth: 1,
              borderColor: color(operation.borderColor),
              borderOpacity: 1,
              scale: 1,
              ...(operation.backgroundColor && {
                color: color(operation.backgroundColor)
              }),
              ...(operation.opacity && { opacity: operation.opacity })
            }
          )
          page.moveDown(operation.paddingTop)
          const headerFont = fonts[operation.headerFont]
          const height = headerFont.heightAtSize(operation.fontSize)

          page.drawText(
            getValue({
              value:
                i === 0
                  ? operation.legend
                  : operation.legendContinued ?? operation.legend,
              data
            }),
            {
              x: template.margin + operation.padding,
              size: operation.fontSize,
              font: headerFont,
              ...(operation.legendColor && {
                color: color(operation.legendColor)
              })
            }
          )

          page.moveDown(height + 20)
          const valueFont = fonts[operation.valueFont]

          let x = 0

          for (const [i, text] of operation.headers
            .map((value) => getValue({ value, data }))
            .entries()) {
            page.drawText(text, {
              x: template.margin + operation.padding + x,
              size: operation.fontSize,
              font: headerFont,
              ...(operation.headerColor && {
                color: color(operation.headerColor)
              })
            })
            x += operation.widths[i] + 3 * operation.padding
          }

          page.moveDown(height + 15)

          x = 0

          for (const row of rows) {
            const height = valueFont.heightAtSize(operation.fontSize)
            for (const [i, text] of operation.values
              .map((value) => getValue({ value, data: row }))
              .entries()) {
              page.drawText(text, {
                x: template.margin + operation.padding + x,
                size: operation.fontSize,
                font: valueFont,
                ...(operation.valueColor && {
                  color: color(operation.valueColor)
                })
              })
              x += operation.widths[i] + 3 * operation.padding
            }

            page.drawSvgPath(`M0,0 L${tableWidth - (15 + 2) * 2},0 Z`, {
              x: template.margin + 15,
              y: page.getY() - height + 4,
              borderWidth: 1,
              borderColor: color(operation.borderColor),
              borderOpacity: 1,
              scale: 1
            })

            page.moveDown(height + 15)
            x = 0
          }
        }
        page = builder.page

        break
      }
      case 'text':
      case 'link': {
        const font = fonts[operation.font]
        const { size, justify } = operation
        const value = getValue({ value: operation.value, data })
        const heights = []
        for (const [index, text] of wrapText({
          text: value,
          width: page.getSize().width - template.margin * 2,
          font,
          fontSize: size
        }).entries()) {
          const width = font.widthOfTextAtSize(text, size)
          const height = font.heightAtSize(size)
          if (index > 0) {
            page.moveDown(height + template.wrapPadding)
            page.moveTo(template.margin, page.getY())
          }
          const textPosition = getTextPosition({
            width,
            page,
            justify,
            margin: template.margin
          })
          page.drawText(text, {
            ...(operation.color && { color: color(operation.color) }),
            font,
            size,
            ...textPosition
          })
          heights.push(height + template.linePadding)
          if (operation.type === 'link') {
            links.push(
              createPageLinkAnnotation({
                page,
                url: getValue({ value: operation.url, data }),
                rect: [
                  textPosition.x,
                  page.getY() + height,
                  textPosition.x + width,
                  page.getY()
                ]
              })
            )
          }
        }
        maxHeight = Math.max(maxHeight, ...heights)

        break
      }
      // No default
    }
  }
  if (maxHeight > 0) page.moveDown(maxHeight)
  if (page.getY() < 0) {
    page = await createNextPage(builder)
  } else {
    page.moveTo(template.margin, page.getY())
  }
  builder.page = page
}

async function drawLayout(builder) {
  const { pdfDoc, template, layout, data, images, links } = builder
  if (!builder.page) {
    builder.page = createPage({ pdfDoc, template, images, data })
  }
  for (const operations of layout) {
    await drawOperations({ builder, operations })
  }

  for (const page of pdfDoc.getPages()) {
    page.node.set(PDFName.of('Annots'), pdfDoc.context.obj(links))
  }
}

function createPageLinkAnnotation({ page, url, rect }) {
  return page.doc.context.register(
    page.doc.context.obj({
      Type: 'Annot',
      Subtype: 'Link',
      Rect: rect,
      Border: [0, 0, 0],
      A: {
        Type: 'Action',
        S: 'URI',
        URI: PDFString.of(url)
      }
    })
  )
}

async function embedFonts({ pdfDoc, fonts }) {
  const embedded = {}
  for (const font of fonts) {
    embedded[font.name] = await pdfDoc.embedFont(StandardFonts[font.value])
  }
  return embedded
}

async function embedImages({ pdfDoc, images }) {
  const embedded = {}
  for (const { type, name, value } of images) {
    if (type === 'image/jpeg') {
      embedded[name] = await pdfDoc.embedJpg(value)
    } else if (type === 'image/png') {
      embedded[name] = await pdfDoc.embedPng(value)
    } else {
      throw new TypeError(`${name} has unsupported image type ${type}`)
    }
  }
  return embedded
}

function drawBackgroundImage({ page, image, opacity }) {
  const pageSize = page.getSize()

  const rotate = image.width > image.height

  const backgroundWidth = rotate ? image.height : image.width
  const backgroundHeight = rotate ? image.width : image.height

  const backgroundScaleWidth = pageSize.width / backgroundWidth
  const backgroundScaleHeight = pageSize.height / backgroundHeight

  const dims =
    backgroundScaleWidth < 1 || backgroundScaleHeight < 1
      ? image.scale(Math.max(backgroundScaleHeight, backgroundScaleWidth))
      : rotate
        ? image.scaleToFit(pageSize.height, pageSize.width)
        : image.scaleToFit(pageSize.width, pageSize.height)

  page.drawImage(image, {
    x: 0,
    y: rotate ? page.getSize().height : 0,
    width: dims.width,
    height: dims.height,
    ...(rotate && { rotate: degrees(-90) }),
    opacity
  })
}

function wrapText({ text, width, font, fontSize }) {
  const words = (text ?? '').split(' ')
  let line = ''
  const result = []
  for (const _word of words) {
    for (const word of _word.split(/(\n)/)) {
      if (word === '\n') {
        result.push(line)
        line = ''
      } else {
        const testLine = line + word + ' '
        const testWidth = font.widthOfTextAtSize(testLine, fontSize)

        if (testWidth >= width) {
          result.push(line)
          line = word + ' '
        } else {
          line = testLine
        }
      }
    }
  }
  result.push(line)
  return result
}

function color({ r, g, b }) {
  return rgb(r / 255, g / 255, b / 255)
}

async function createNextPage(builder) {
  const { template } = builder
  builder.page = await createPage(builder)
  for (const operations of template.pageNumberHeader) {
    await drawOperations({ builder, operations })
  }
  builder.page.moveTo(
    template.margin,
    builder.page.getSize().height - template.margin
  )
  return builder.page
}

function createPage({ template, pdfDoc, images, data }) {
  const page = pdfDoc.addPage(PageSizes.A4)
  if (template.background?.image) {
    drawBackgroundImage({
      page,
      ...template.background.image,
      image: images[template.background.image.name]
    })
  }
  data.page++
  if (data.countPages) {
    data.pageTotal++
  }
  const { height } = page.getSize()
  page.moveTo(0, height)
  return page
}

function getTextPosition({ page, width, justify, margin }) {
  switch (justify) {
    case 'LEFT': {
      return { x: page.getX() }
    }
    case 'RIGHT': {
      return { x: page.getSize().width - width - margin }
    }
    case 'CENTER': {
      return {
        x: (page.getSize().width - width) / 2
      }
    }
    // No default
  }
}

function getValue({ value, data }) {
  if (value?.includes('$.')) {
    const fields = [...value.match(VALUES)]
    for (const field of fields) {
      let current = data
      for (const key of field.slice(2).split('.')) {
        current = current?.[key]
      }
      value = value.replace(field, current ?? '')
    }
    return value
  } else {
    return value
  }
}

function getFieldValues({ value, data }) {
  if (value?.includes('$.')) {
    const field = value
    let current = data
    for (const key of field.slice(2).split('.')) {
      current = current?.[key]
    }
    return current
  } else {
    return value
  }
}

async function* wrapTable({ operation, builder }) {
  const { data, fonts } = builder
  const rows = [...getFieldValues({ value: operation.root, data })]
  const tableWidth = builder.page.getSize().width - 50 * 2
  let i = 0

  function calculateHeight(count) {
    return (
      fonts.bold.heightAtSize(operation.fontSize) * count +
      operation.paddingTop +
      20 +
      operation.padding * count +
      5 +
      10 +
      4
    )
  }

  function calculateBestFit(count) {
    const heightLeft = builder.page.getY()
    let tableHeight = calculateHeight(count)
    while (tableHeight + 10 > heightLeft) {
      tableHeight = calculateHeight(--count)
    }
    return count
  }

  while (rows.length > 0) {
    const count = calculateBestFit(rows.length)
    const tableHeight = calculateHeight(count)
    yield {
      rows: rows.splice(0, count),
      tableWidth,
      tableHeight,
      page: builder.page,
      i
    }
    i++
    if (rows.length > 0) {
      builder.page = await createNextPage(builder)
    }
  }
}

export function fontNames() {
  return Object.keys(StandardFonts)
}

export function placeHolderNames(template) {
  const layout = [
    ...template.pageNumberHeader,
    ...template.header,
    ...template.details,
    ...template.footer
  ].filter(Boolean)
  const names = []
  for (const header of layout) {
    for (const detail of header) {
      if (detail?.type === 'text') {
        const value = detail.value
        if (value?.includes('$.')) {
          for (const field of value.match(VALUES)) {
            names.push(field)
          }
        }
      }
      if (detail?.type === 'table') {
        const root = detail.root
        for (const value of detail.values) {
          if (value?.includes('$.')) {
            for (const field of value.match(VALUES)) {
              names.push(`${root}[].${field}`)
            }
          }
        }
      }
    }
  }

  return [...new Set(names)]
}

export function imageNames(template) {
  const layout = [
    ...template.pageNumberHeader,
    ...template.header,
    ...template.details,
    ...template.footer
  ].filter(Boolean)
  const names = []
  if (template.background?.image) {
    names.push(template.background.image.name)
  }
  for (const header of layout) {
    for (const detail of header) {
      if (detail?.type === 'image') {
        names.push(detail.name)
      }
    }
  }

  return [...new Set(names)]
}
