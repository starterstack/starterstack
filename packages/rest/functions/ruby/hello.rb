load File.join(__dir__, 'vendor/bundle/bundler/setup.rb')

require 'json'

def handler(event:, context:)
  puts "event #{JSON.pretty_generate(event)}"
  email = event['requestContext']['authorizer']['email']
  if email.nil?
    body_json = { 'hello': 'Hej! from ruby' }
  else
    body_json = { 'hello': "Hej #{email}! from ruby" }
  end
  {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.generate(body_json)
  }
end
