// 마지막으로 초점을 옮긴 수단이 키보드(Tab)인지 마우스·터치인지 기억한다.
// PC에서 문장·해설 칸을 마우스로 누르면 그 칸이 초점을 잡아, 뒤이은 Space가 재생/일시정지 대신
// 그 칸의 '누르기'(문장 처음으로 이동·풀이 펼치기)로 먹혔다(2026-11-27 사용자 보고).
// 키보드로 Tab 해서 온 사람에게만 Space = 그 칸 누르기로 남기고, 마우스로 누른 뒤의 Space는 재생/일시정지로 보낸다.
let modality = 'pointer';

if (typeof window !== 'undefined') {
    window.addEventListener('pointerdown', () => { modality = 'pointer'; }, true);
    window.addEventListener('keydown', (e) => { if (e.key === 'Tab') modality = 'keyboard'; }, true);
}

export const focusedByKeyboard = () => modality === 'keyboard';

// 시험용
export const __setModality = (m) => { modality = m; };
