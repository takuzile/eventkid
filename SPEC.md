# グループイベント管理アプリ — 設計仕様（ビルド引き継ぎ用）

> このファイルは設計セッションの確定事項を Claude Code に引き継ぐためのもの。
> リポジトリ直下に置き、作業開始時にまず読ませること。
> アプリ名は未定（仮称「EventKit」）。確定したら全体を置換。

---

## 1. コンセプト

**「イベントに紐づく名簿に対して、構造化データを集め、その上で処理を走らせる箱」**

調整さんクローンではなく、汎用イベント基盤。3層構造:

1. **収集基盤（汎用・土台）** — イベント / 名簿 / カスタムフォーム / 回答。価値の8割。
2. **本人特定（identity）** — 回答を「誰の」と紐づける層。LINE LIFF。
3. **処理モジュール（operation）** — 集めたデータを食って出力する層。配車・ワリカン・部屋割り等は全てここのプラグインで互いに独立。

配車もワリカンも「収集基盤の上に乗る別アプリ」。コアは1個のまま機能は足し引き自由。

---

## 2. 技術スタック（推奨デフォルト / 既存資産に合わせたもの・変更可）

- **Backend**: Express.js
- **DB**: PostgreSQL（Railway ホスティング）
- **Session**: connect-pg-simple
- **Identity**: LINE LIFF + LINE Login チャネル（※ bcrypt パスワード認証は使わない）
- **Domain/Proxy**: Cloudflare（LIFF は HTTPS 必須）

---

## 3. コア設計判断（確定）

| 項目 | 決定 |
|---|---|
| 質問モデル | **3層ハイブリッド**（ビルトイン / 意味型 / 純汎用） |
| 出欠 | **両対応**（segment を常に出欠の単位にし、シンプルモードは「区間1個」で表現。UIが畳む） |
| identity | **C: LINE固定で実装、非LINE(URL)対応は非破壊で後付け可能な設計に寄せる** |
| 意味タグ語彙 | `location` / `capacity` / `money`（モジュールが要求する分だけ。増やすのは新モジュール追加時のみ） |
| モジュール契約 | 必要な意味タグを宣言 → 該当質問があれば自動バインド、無ければ幹事に手動マッピング or 作成を促す。スコープ軸（イベント全体 / 区間ごと）を持つ |
| ロール | **A: 単一幹事（作成者のみ organizer）+ 参加者**。ロールはイベント単位（あるイベントで幹事、別では参加者が自動成立。グローバルな幹事アカウントは作らない） |

### 3層ハイブリッドの定義
- **ビルトイン項目**: 出欠ステータス・本人特定。全イベント共通、カスタム質問ではない。
- **意味型カスタム項目**: 汎用フィールド（text/select/number…）に意味タグ（location 等）を1個被せただけ。保存は汎用のまま、モジュールには意味が伝わる。新しいフィールド型は作らない。
- **純汎用カスタム項目**: Tシャツサイズ・食事制限など。収集・表示のみ、ロジック無し。

---

## 4. データモデル（DDL スケッチ）

```sql
-- イベント
events(
  id, name, description,
  segmented   boolean default false,   -- 表示の出し分けのみ（trueで区間UIを表示）
  status,                              -- draft/open/closed（※状態遷移は未確定・§7）
  created_at
)

-- 区間（シンプルモードでも必ず1行存在する。出欠の単位）
segments(
  id, event_id references events,
  name, starts_at, ends_at, sort_order
)

-- 名簿（イベント単位。participant_id が唯一の正準キー）
participants(
  id, event_id references events,
  display_name,
  role          default 'participant',  -- 'organizer'/'participant'（確定A: organizer は作成者1人のみ）
  auth_provider default 'line',         -- 将来 'url' 等を追加
  line_user_id  null,                   -- LINE以外の参加者は null
  responded_at  null,                   -- null = 未回答（フォーム未提出）
  created_at
)
-- 1イベント1人を担保しつつ将来の null 行に備えた部分unique:
-- CREATE UNIQUE INDEX ON participants(event_id, line_user_id) WHERE line_user_id IS NOT NULL;

-- カスタムフォーム定義
questions(
  id, event_id references events,
  label,
  field_type,    -- text/select/multiselect/number/bool/date
  semantic null, -- location/capacity/money など意味タグ（任意）
  options json,  -- select の選択肢など
  required boolean default false,
  sort_order
)

-- 回答
answers(
  id,
  participant_id references participants,
  question_id    references questions,
  value          -- 汎用に文字列/JSON で保持
)

-- 出欠（参加者 × 区間）
attendance(
  id,
  participant_id references participants,
  segment_id     references segments,
  status         -- '出'/'欠'
)
-- UNIQUE(participant_id, segment_id)
```

**設計上の鉄則**: attendance / answers / その他すべてのモジュールは `participant_id` を基点に FK する。`line_user_id` を「ユーザーの鍵」として持ち回らない。LINE は participant を特定する手段の1つにすぎない。これにより identity プロバイダ追加（§7のB）が非破壊の追加作業で済む。

---

## 5. 主要フロー

1. 幹事が管理画面でイベント + 区間 + カスタム質問を作成
2. 生成された **LIFF の URL** を LINE グループに貼る
3. メンバーがタップ → LINE内ブラウザでフォームが開く
4. `liff.login()` → `liff.getProfile()` で user_id と表示名を取得 → participant に紐付け
5. 出欠 + カスタム質問に回答 → `responded_at` を記録
6. 未回答者はグループにプッシュ通知（「未回答: N名」）
7. 土台完成後、処理モジュール（配車・ワリカン等）が回答データを食って出力

---

## 6. 技術的制約・注意（必ず守る）

- **LINE はグループメンバーを自動列挙できない**。全員の user ID 取得 API は verified/premium アカウント限定。未認証では取れるのは webhook で「喋った/参加した」人の ID のみ。→ **LIFF による各自1タップ自己登録**で回避する（メンバー自動認識は実装しない）。
- **個別リマインドの制約**: 特定個人への 1:1 DM はその人がボットを友だち追加済みの場合のみ。基本はグループへのプッシュ通知で対応。
- **participant_id を唯一の正準キーに**（§4鉄則）。
- **部分unique index** を最初から張る（`line_user_id IS NOT NULL` の行だけ）。
- **location のジオコーディング**: 駅名文字列は距離計算に直接使えない（緯度経度が必要）。デフォルトは「遅延評価（文字列だけ保存し、配車モジュール実行時に変換）」。方式は §7。
- **(Windows 環境)** 日本語を含むファイル編集は文字化けに注意（エンコーディング崩れ実績あり）。Node 再起動前に全プロセスを停止すること。

---

## 7. 未決定（要判断・暫定デフォルトを記載）

| 項目 | 選択肢 | 暫定デフォルト |
|---|---|---|
| ジオコーディング方式 | a:座標つき駅マスタ+select / b:自由入力+API変換 / c:遅延評価 | **c（遅延）** |
| イベント状態遷移 | draft→open→closed→archived の粒度 | 暫定 draft/open/closed の3状態 |
| 回答開始後の質問編集 | 不可 / 警告付きで可 / 区間を切って可 | 未検討 |
| 最初に作るモジュール | 配車 / ワリカン / 部屋割り | **MVP では作らない（収集コアのみ）** |

---

## 8. MVP スコープ

**収集コアのみ**を最初に作る:
- イベント + 区間 + カスタム質問の作成（幹事）
- LIFF 自己登録 + 出欠 + カスタム質問回答（参加者）
- 未回答者の把握 + グループ通知

処理モジュール（配車・ワリカン）は土台が固まってから別途。モジュールは収集コアに依存するが、コアはモジュールに依存しない（一方向）。

---

## 9. Claude Code への最初の指示例

```
このリポジトリの SPEC.md を読んで。
まず §8 の MVP スコープ（収集コアのみ）を対象に、
§2 のスタックで §4 のデータモデルを Postgres マイグレーションとして起こし、
Express のプロジェクト雛形と、イベント/質問の CRUD API、
LIFF 自己登録 + 回答送信のエンドポイントまでを作って。
§6 の制約（特に participant_id 正準キーと部分unique）は厳守。
配車・ワリカン等のモジュールはこの段階では作らない。
```
