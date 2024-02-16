export default {
  language: 'en-US',
  pdfName: 'ExternalPdf',
  title: 'PDF',
  subject: '$.subject',
  fonts: [
    { name: 'regular', value: 'Helvetica' },
    { name: 'bold', value: 'HelveticaBold' }
  ],
  margin: 50,
  wrapPadding: 3,
  linePadding: 3,
  background: {
    image: {
      name: 'background',
      opacity: 0.15
    }
  },
  pageNumberHeader: [
    [
      {
        type: 'move',
        down: 30
      },
      {
        type: 'text',
        font: 'regular',
        size: 10,
        value: 'Page $.page / $.pageTotal',
        justify: 'RIGHT'
      }
    ]
  ],
  header: [
    [
      {
        type: 'move',
        up: 30,
        left: 30
      },
      {
        type: 'image',
        name: 'logo',
        scale: 0.25,
        opacity: 0.5
      }
    ],
    [
      {
        type: 'move',
        down: 50
      }
    ],
    [
      {
        type: 'text',
        font: 'bold',
        size: 40,
        value: '$.title',
        color: {
          r: 80,
          g: 85,
          b: 70
        },
        justify: 'CENTER'
      }
    ]
  ],

  footer: [
    [
      {
        type: 'position',
        y: 50
      },
      {
        type: 'text',
        font: 'bold',
        size: 12,
        value: 'Address',
        justify: 'LEFT'
      },
      {
        type: 'link',
        font: 'regular',
        size: 10,
        value: '$.company.email',
        url: 'mailto:$.company.email',
        justify: 'RIGHT'
      }
    ],
    [
      {
        type: 'text',
        font: 'regular',
        size: 10,
        value: '$.company.name',
        justify: 'LEFT'
      },
      {
        type: 'text',
        font: 'regular',
        size: 10,
        value: '$.company.phone',
        justify: 'RIGHT'
      }
    ],
    [
      {
        type: 'text',
        font: 'regular',
        size: 10,
        value:
          '$.company.address.street, $.company.address.zipCode $.company.address.city',
        justify: 'LEFT'
      },
      {
        type: 'link',
        font: 'regular',
        size: 10,
        value: '$.company.domain',
        url: '$.company.url',
        justify: 'RIGHT'
      }
    ]
  ],
  details: [
    [
      {
        type: 'text',
        font: 'bold',
        size: 12,
        value: 'Invoice address',
        justify: 'LEFT'
      }
    ],
    [
      {
        type: 'text',
        font: 'regular',
        size: 12,
        value: '$.company.name',
        justify: 'LEFT'
      }
    ],
    [
      {
        type: 'text',
        font: 'regular',
        size: 12,
        value: '$.company.address.street',
        justify: 'LEFT'
      }
    ],
    [
      {
        type: 'text',
        font: 'regular',
        size: 12,
        value: '$.company.address.zipCode $.company.address.city',
        justify: 'LEFT'
      }
    ],
    [
      {
        type: 'move',
        down: 15
      }
    ],
    [
      {
        type: 'table',
        root: '$.products',
        fontSize: 10,
        headerFont: 'bold',
        valueFont: 'regular',
        headerColor: {
          r: 1,
          g: 1,
          b: 1
        },
        valueColor: {
          r: 1,
          g: 1,
          b: 1
        },
        legendColor: {
          r: 1,
          g: 1,
          b: 1
        },
        headers: ['Name', 'Quantity', 'Price/unit', 'Total'],
        values: ['$.name', '$.quantity', '$.price', '$.total'],
        widths: [190, 30, 60, 60],
        legend: 'Products',
        legendContinued: 'Products (continued)',
        paddingTop: 30,
        padding: 15,
        opacity: 0.6,
        backgroundColor: {
          r: 255,
          g: 255,
          b: 255
        },
        borderColor: {
          r: 200,
          g: 200,
          b: 200
        }
      }
    ],
    [
      {
        type: 'move',
        down: 30
      }
    ],
    [
      {
        type: 'text',
        font: 'bold',
        size: 12,
        value: 'Total amount excluding VAT:',
        justify: 'LEFT'
      },
      {
        type: 'text',
        font: 'bold',
        size: 12,
        value: '$.totalPriceExcludingVAT EUR',
        justify: 'RIGHT'
      }
    ]
  ]
}
