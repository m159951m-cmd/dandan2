// ▼ Firebase 연결 정보 (dandan2 프로젝트)
const firebaseConfig = {
  apiKey: "AIzaSyCUSzXHn81kfoshuJHEBIZmyMV3rwEqTyA",
  authDomain: "dandan2-7e308.firebaseapp.com",
  projectId: "dandan2-7e308",
  storageBucket: "dandan2-7e308.firebasestorage.app",
  messagingSenderId: "495882936237",
  appId: "1:495882936237:web:e6ab60152297e861fb8b24",
  measurementId: "G-M5W62MS65Y"
};

// ▼ 이 줄은 지우지 마세요
// ▼ 1번 메뉴 "자료취합" 앱 주소 (없으면 "" 로 두세요)
const collectUrl = "https://huei19821982-alt.github.io/2026/";
// ▼ 자료취합 앱의 Firebase 연결 정보 (마감 알림용, 공개돼도 되는 값 · 접속 코드는 넣지 않음)
const collectFirebase = {
  apiKey: "AIzaSyBeBcn0mHiZEKGWPAog_QvQ6BdqiDl-rk0",
  authDomain: "gne-2026.firebaseapp.com",
  projectId:  "gne-2026",
  storageBucket:  "gne-2026.firebasestorage.app",
  messagingSenderId: "599221984462",
  appId: "1:599221984462:web:88371ebae5edb588e0049f"
};
export { firebaseConfig, collectUrl, collectFirebase };
