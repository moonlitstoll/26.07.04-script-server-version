// 인터넷 없이 앱이 열리게 된 뒤(public/sw.js), AI가 필요한 버튼은 누를 때 바로 안내한다.
// 예전엔 한참 돌다가 영어 오류가 떴다.
export const OFFLINE_MESSAGE = '인터넷 연결이 필요해요';

// navigator.onLine === false 는 '확실히 끊김'일 때만 나온다(와이파이는 잡혔는데 인터넷이 안 되는 경우는 true).
// 그래서 false일 때만 막는다 — 모르는 상황에서 AI 기능을 잘못 막지 않으려고.
export const isOffline = (nav = typeof navigator !== 'undefined' ? navigator : null) => !!nav && nav.onLine === false;
