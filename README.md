# BUTU (物々交換) - Minimal Microservices

起動: `docker compose up --build`

フロント: http://localhost:3100

API（開発用ポート）:
- auth-svc     http://localhost:4100
- listing-svc  http://localhost:4110
- trade-svc    http://localhost:4120
- fx-svc       http://localhost:4130
- shipping-svc http://localhost:4140

shipping-svc（画面）:
- ヤマト管理: http://localhost:4140/yamato/orders
- ラベル印刷: http://localhost:4140/labels/<label_code>

初期ユーザー:
- test@test.com / pass (user)
- test2@test.com / pass (user)
- ops@test.com / pass (admin)

メモ:
- DBはサービスごとに分離（auth/listing/trade/fx/shipping）。
- trade成立(accept)時に shipping-svc へ「双方分」のラベルを内部APIで作成します（冪等）。
