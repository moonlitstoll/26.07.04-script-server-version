import { describe, it, expect } from 'vitest';
import { placePopoverLeft, selectRowExtras } from '../toolbarMenu';

describe('툴바 팝오버 위치', () => {
    // 실측 화면 폭 390px(휴대폰) 기준
    it('가운데 맞춤: 칩 가운데 아래에 놓는다', () => {
        expect(placePopoverLeft({ anchorLeft: 150, anchorRight: 230, width: 120, viewport: 390 })).toBe(130);
    });

    it('오른쪽 끝 맞춤: 패널 오른쪽 끝이 칩 오른쪽 끝과 같다', () => {
        expect(placePopoverLeft({ anchorLeft: 342, anchorRight: 378, width: 256, viewport: 390, align: 'end' })).toBe(122);
    });

    it('왼쪽 끝 칩: 화면 밖으로 안 나가게 여백 8px에 붙인다', () => {
        expect(placePopoverLeft({ anchorLeft: 12, anchorRight: 90, width: 320, viewport: 390 })).toBe(8);
    });

    it('오른쪽 끝 칩: 패널 오른쪽이 화면 오른쪽 여백 안에 들어온다', () => {
        // 가운데 맞춤이면 360 - 160 = 200 → 200 + 320 = 520 > 382 이므로 390 - 8 - 320 = 62
        expect(placePopoverLeft({ anchorLeft: 340, anchorRight: 380, width: 320, viewport: 390 })).toBe(62);
    });

    it('패널이 화면보다 넓으면 왼쪽 여백에 붙인다', () => {
        expect(placePopoverLeft({ anchorLeft: 300, anchorRight: 340, width: 400, viewport: 390 })).toBe(8);
    });
});

describe('고치기 줄에 있을 때만 붙는 버튼', () => {
    it('기본: 아무것도 없다(휴지통이 비었고 빠진 대사도 없음)', () => {
        expect(selectRowExtras({})).toEqual([]);
        expect(selectRowExtras()).toEqual([]);
    });

    it('지운 문장이 있으면 휴지통이 개수와 함께 생긴다', () => {
        const items = selectRowExtras({ trashCount: 3 });
        expect(items.map(i => i.id)).toEqual(['trash']);
        expect(items[0].label).toBe('휴지통 3');
    });

    it('빠진 대사 끝이 있으면 재감지 버튼이 생긴다', () => {
        const items = selectRowExtras({ missingSpeechEnds: 5 });
        expect(items.map(i => i.id)).toEqual(['detectMissing']);
        expect(items[0].label).toBe('빠진 대사 5');
    });

    it('둘 다 있으면 휴지통이 먼저', () => {
        expect(selectRowExtras({ trashCount: 1, missingSpeechEnds: 2 }).map(i => i.id)).toEqual(['trash', 'detectMissing']);
    });

    it('문장을 고른 동안은 둘 다 숨긴다(버튼 줄이 3줄로 늘지 않게)', () => {
        expect(selectRowExtras({ trashCount: 2, missingSpeechEnds: 5, selectedCount: 1 })).toEqual([]);
        expect(selectRowExtras({ trashCount: 2, missingSpeechEnds: 5, selectedCount: 0 }).map(i => i.id)).toEqual(['trash', 'detectMissing']);
    });

    it('감지 중이면 재감지 버튼을 숨긴다(두 번 누르기 방지), 휴지통은 그대로', () => {
        expect(selectRowExtras({ trashCount: 2, missingSpeechEnds: 5, speechBusy: true }).map(i => i.id)).toEqual(['trash']);
    });
});
