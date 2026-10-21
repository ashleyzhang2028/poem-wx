# 跬步 · 古诗词背诵小程序

微信小程序端的古诗词背诵工具。

## 运行

```bash
npm test          # 编译语料 + 跑自检（只需 node ≥18，不必 npm install）
```

用微信开发者工具打开 `miniprogram/`。体验版由 `main` 的流水线在打包前自己构建，
用户端不需要任何构建。

## 入口

- 页面与分包：`miniprogram/app.json`
- 后端与部署：`api/`、`deploy/`
- 流水线：`.cnb.yml`
- 文档：`docs/`（对照与未做项分别见 [`docs/parity.md`](docs/parity.md)、[`docs/todo.md`](docs/todo.md)）
