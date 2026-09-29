# kintone-plugins

自作の kintone プラグインをまとめて管理するリポジトリです。

## プラグイン一覧

| フォルダ | プラグイン名 | バージョン | プラグインID | 概要 |
|---|---|---|---|---|
| [simple-field-manager](plugins/simple-field-manager) | フィールド一括管理 | 1.4 | `ehpmdoijfnmgmpkcjjcifbflgfkpgihl` | フィールド設定（名前・コード・必須・重複禁止・ラベル非表示など）を一覧で確認・一括編集 |

## ビルド（パッケージ化）

```bash
npx @kintone/plugin-packer --ppk ~/keys/<プラグインID>.ppk plugins/<フォルダ名>
```

- 同じプラグインIDでバージョンアップするには、初回と同じ秘密鍵（.ppk）が必要です。
- 鍵を指定しないと新しい鍵が生成され、別のプラグイン（新しいID）になります。
- 配布用の zip は GitHub Releases に添付してください（リポジトリにはコミットしません）。

## 秘密鍵（.ppk）の扱い

- `.ppk` は `.gitignore` で除外しています。**絶対にコミットしないでください。**
- 鍵はリポジトリの外（例: `~/keys/` とパスワードマネージャー）で保管します。
