# シフト帳 - バイト管理PWA

時給・勤務先を登録して、シフトと給与をPC・スマホ両方から管理できるアプリです。
ホーム画面に追加すればアプリのように使え、iPhoneカレンダーへの取り込みにも対応しています。

## できること

- 複数のバイト先(時給・カラー)を登録
- カレンダーからシフトを登録・編集・削除
- 月ごとの給与見込みを自動集計(バイト先ごとの内訳つき)
- PCで登録 → スマホでも自動的に同期(Firebaseアカウントでログイン)
- iPhoneのカレンダーに取り込める `.ics` ファイルを書き出し
- オフラインでもアプリ画面が開ける(PWA / Service Worker)

---

## セットアップ手順

### 1. Firebaseプロジェクトを作る(無料)

1. https://console.firebase.google.com/ にアクセスし、Googleアカウントでログイン
2. 「プロジェクトを追加」→ 適当な名前(例: shift-board)を入力して作成
3. 左メニュー「構築」→「Authentication」→「始める」→ ログイン方法で **メール/パスワード** を有効化
4. 左メニュー「構築」→「Firestore Database」→「データベースの作成」
   - ロケーションは `asia-northeast1`(東京)がおすすめ
   - 開始時のルールは「本番環境モード」を選択(後述のルールを設定するため)
5. 左メニュー「プロジェクトの設定」(歯車アイコン)→「全般」タブ→ 一番下の「マイアプリ」→ `</>`(ウェブ)アイコンをクリックしてアプリを登録
6. 表示された `firebaseConfig` の値をコピー

### 2. 設定ファイルに値を貼り付ける

`js/firebase-config.js` を開き、コピーした値を貼り付けます。

```js
export const firebaseConfig = {
  apiKey: "実際の値",
  authDomain: "実際の値",
  projectId: "実際の値",
  storageBucket: "実際の値",
  messagingSenderId: "実際の値",
  appId: "実際の値",
};
```

### 3. Firestoreのセキュリティルールを設定する

Firebaseコンソール →「Firestore Database」→「ルール」タブで、以下の内容に置き換えて「公開」します。
自分のデータだけを自分だけが読み書きできるようにするルールです。

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{userId}/{document=**} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
  }
}
```

### 4. デプロイする(どちらか好きな方法で)

**方法A: GitHub Pages(無料・おすすめ)**

1. GitHubで新しいリポジトリを作成し、このフォルダの中身をすべてアップロード
2. リポジトリの Settings → Pages → Source で `main` ブランチ・ `/ (root)` を選択して保存
3. 数分後に表示されるURL(`https://ユーザー名.github.io/リポジトリ名/`)でアクセスできます

**方法B: Netlify / Vercel**

このフォルダをそのままドラッグ&ドロップするだけで公開できます。

> ⚠️ 必ず **https** で公開してください(GitHub Pages/Netlify/Vercelはどれも自動でhttpsになります)。
> PWAの機能(ホーム画面追加・オフライン対応)はhttps環境でないと動作しません。

### 5. アカウントを作る & ホーム画面に追加する

1. 公開したURLをブラウザ(PC・iPhoneどちらでも)で開く
2. 「初めての方はこちら(新規登録)」からメールアドレスとパスワードを登録
3. **同じメールアドレス・パスワードで、もう片方の端末でもログイン** → 自動的にデータが同期されます
4. iPhoneのSafariでURLを開き、共有ボタン →「ホーム画面に追加」を選ぶとアプリのように使えます

---

## iPhoneカレンダーへの登録方法

「設定」タブ →「iPhoneカレンダーに登録」から `.ics` ファイルをダウンロードできます。

- iPhone(Safari)でダウンロードした場合: ダウンロード後に表示される通知、または「ファイル」アプリから該当ファイルをタップすると、カレンダーへの追加画面が開きます
- PCでダウンロードした場合: AirDropやメール、iCloud DriveなどでiPhoneに送ってから開いてください

シフトを追加・変更するたびに、この書き出し操作をもう一度行うと最新の内容に更新されます。
(自動で常に同期し続ける「購読カレンダー」機能ではなく、必要なタイミングで書き出す方式です)

---

## データの持ち方について

- ワークプレイス(バイト先): `users/{あなたのuid}/workplaces/{id}`
- シフト: `users/{あなたのuid}/shifts/{id}`

Firestoreの無料枠(Sparkプラン)で個人利用には十分な範囲で収まります。

## カスタマイズのヒント

- `css/style.css` の `:root` にある色・フォントの変数を変えるだけで全体の見た目を変更できます
- バイト先の色は `js/app.js` の `WORKPLACE_COLORS` 配列で編集できます
