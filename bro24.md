# This an example how it will work our the bro24.uz API

curl -X POST https://dashboard.bro24.uz/api/v1/public/chat \
  -H "X-API-Key: <Ваш API-ключ>" -H "Content-Type: application/json" \
  -d '{"client_id": "client-42", "channel": "website", "message": "Сколько стоит курс?"}'

