// ここに、あなた自身のFirebaseプロジェクトの設定値を入れてください。
// 取得方法は README.md の「Firebaseのセットアップ」を参照してください。
//
// Firebaseコンソール > プロジェクトの設定 > 全般 > マイアプリ > SDKの設定と構成
// に表示される firebaseConfig をそのままコピーして貼り付ければOKです。

// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import { getAnalytics } from "firebase/analytics";
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyBZPH_LPVx0I5ecONp-n12KDhMpDVt0V5o",
  authDomain: "quonsuntory-ptj.firebaseapp.com",
  projectId: "quonsuntory-ptj",
  storageBucket: "quonsuntory-ptj.firebasestorage.app",
  messagingSenderId: "456825515609",
  appId: "1:456825515609:web:17e37b2323fcace4444b48",
  measurementId: "G-TEL1Z4X6JZ"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);