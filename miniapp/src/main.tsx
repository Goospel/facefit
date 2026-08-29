import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import './index.css';
import { App } from './App';

const root = document.getElementById('root');
if (!root) throw new Error('#root를 찾지 못했습니다');

/**
 * StrictMode를 켠다 — 이 앱은 카메라 스트림·blob URL·재생 타이머처럼 **정리 함수가 있어야
 * 하는 effect**로 이루어져 있다. 개발 모드의 이중 마운트가 그 누락을 즉시 드러낸다
 * (안 놓은 스트림은 「카메라가 켜진 채로 남는다」로, 안 놓은 URL은 조용한 메모리 증가로 나타난다).
 */
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
