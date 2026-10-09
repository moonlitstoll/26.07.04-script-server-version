// Stage 2 마커 파서 검증.
// 이 파일이 지키는 핵심 두 가지:
//  1) 정상(마커가 각 블록에 바르게 붙은) 응답에는 결과가 예전과 '완전히 동일'하다(회귀 없음).
//  2) 모델이 END 마커를 제 블록 뒤가 아니라 응답 끝에 '몰아서' 출력해도(실측 버그) 각 문장이
//     뒤 문장들의 [분석]을 삼키지 않는다 — 이게 스크린샷으로 보고된 '문장별 분석 누적' 오류.
//
// #2 테스트는 끝-경계 clamp(min(자기 END, 다음 문장 START))를 되돌리면 즉시 실패한다 —
// 즉 이 버그를 실제로 지키는 가드다(빈 통과 방지).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { parseStage2Response, ANALYSIS_PREFIX_STRIP } from '../stage2Parser';

// 실제 화면(스크린샷)과 같은 3연속 문장. 누적 오류가 났던 바로 그 구간을 본뜬다.
const S1 = { i: 1, tr: '숟가락과 접시에도 남은 밥이 없었다.', a: ['Thìa đĩa: 숟가락과 접시', 'cũng không có: ~도 없었다', 'cơm thừa: 남은 밥'] };
const S2 = { i: 2, tr: '가게 분위기는 꽤나 멋지고 시원하다고 느꼈다.', a: ['Không gian quán: 가게 공간/분위기', 'khá là đẹp: 꽤나 멋지다', 'thoáng mát: 시원하다'] };
const S3 = { i: 3, tr: '테이블과 의자는 깨끗했다.', a: ['Bàn ghế: 테이블과 의자', 'thì sạch sẽ: 깨끗했다'] };

const items = (...ss) => ss.map(s => ({ index: s.i }));

// 마커가 각 블록에 바르게 붙은 '정상' 블록.
const block = (s) =>
    `--- [INDEX: ${s.i}] START ---\n[번역] ${s.tr}\n${s.a.map(a => `[분석] ${a}`).join('\n')}\n--- [INDEX: ${s.i}] END ---`;

// START + 본문만 (자기 END는 뒤에서 몰아 붙이기 위해 뺀다).
const openBlock = (s) =>
    `--- [INDEX: ${s.i}] START ---\n[번역] ${s.tr}\n${s.a.map(a => `[분석] ${a}`).join('\n')}`;
const endMarker = (s) => `--- [INDEX: ${s.i}] END ---`;

beforeEach(() => { vi.spyOn(console, 'warn').mockImplementation(() => {}); });
afterEach(() => { vi.restoreAllMocks(); });

describe('parseStage2Response — 정상 응답 (회귀 방어)', () => {
    it('문장마다 자기 번역/분석만 뽑고, 서로 섞이지 않는다', () => {
        const text = [block(S1), block(S2), block(S3)].join('\n\n');
        const res = parseStage2Response(text, items(S1, S2, S3));

        expect(res).toHaveLength(3);
        expect(res[0]).toMatchObject({ index: 1, translation: S1.tr, analysis: S1.a.join('\n'), transcriptSuspect: '' });
        expect(res[1]).toMatchObject({ index: 2, translation: S2.tr, analysis: S2.a.join('\n') });
        expect(res[2]).toMatchObject({ index: 3, translation: S3.tr, analysis: S3.a.join('\n') });
        // 아무도 failed가 아니다
        expect(res.some(r => r.failed)).toBe(false);
    });

    it('한 문장의 여러 [분석] 줄이 다음 START에서 잘려나가지 않는다 (early-clamp 방지)', () => {
        const text = [block(S1), block(S2)].join('\n\n');
        const res = parseStage2Response(text, items(S1, S2));
        // S1은 분석 3줄 전부를 보존해야 한다 (다음 START로 너무 일찍 자르면 뒤 2줄이 사라진다)
        expect(res[0].analysis.split('\n')).toHaveLength(S1.a.length);
        expect(res[0].analysis).toBe(S1.a.join('\n'));
    });

    it('비연속 INDEX(문맥 문장이 사이에 낀 배치)도 각자 제 것만 뽑는다', () => {
        const A = { i: 5, tr: '번역5', a: ['x5: 뜻5'] };
        const B = { i: 8, tr: '번역8', a: ['x8: 뜻8', 'y8: 뜻8b'] };
        const text = [block(A), block(B)].join('\n\n');
        const res = parseStage2Response(text, items(A, B));
        expect(res[0]).toMatchObject({ index: 5, translation: '번역5', analysis: 'x5: 뜻5' });
        expect(res[1]).toMatchObject({ index: 8, analysis: 'x8: 뜻8\ny8: 뜻8b' });
    });
});

describe('parseStage2Response — END 마커 몰림 (스크린샷 누적 버그)', () => {
    // 레이아웃: START1..3 블록이 먼저, 그 뒤에 END1,END2,END3 를 몰아서.
    // 예전 파서는 S1의 끝을 'END1(맨 뒤)'로 잡아 S1이 S2·S3 분석까지 삼켰다.
    const grouped = [
        openBlock(S1), openBlock(S2), openBlock(S3),
        endMarker(S1), endMarker(S2), endMarker(S3),
    ].join('\n\n');

    it('각 문장이 자기 분석만 갖고, 뒤 문장 분석을 누적하지 않는다', () => {
        const res = parseStage2Response(grouped, items(S1, S2, S3));

        expect(res[0].analysis).toBe(S1.a.join('\n'));
        expect(res[1].analysis).toBe(S2.a.join('\n'));
        expect(res[2].analysis).toBe(S3.a.join('\n'));
    });

    it('S1 분석에 S2·S3의 청크가 새어들지 않는다 (누적의 직접 증거)', () => {
        const res = parseStage2Response(grouped, items(S1, S2, S3));
        expect(res[0].analysis).not.toContain('Không gian quán'); // S2
        expect(res[0].analysis).not.toContain('Bàn ghế');         // S3
        expect(res[1].analysis).not.toContain('Bàn ghế');         // S3
    });

    it('번역은 항상 자기 것 (오염 없음 — .match 첫 줄)', () => {
        const res = parseStage2Response(grouped, items(S1, S2, S3));
        expect(res[0].translation).toBe(S1.tr);
        expect(res[1].translation).toBe(S2.tr);
        expect(res[2].translation).toBe(S3.tr);
    });

    it('END가 일부만 몰려도(부분 이탈) 다음 START가 경계를 지킨다', () => {
        // S1은 정상(자기 END 제자리), S2·S3의 END만 뒤로 몰림.
        const partial = [
            block(S1), openBlock(S2), openBlock(S3),
            endMarker(S2), endMarker(S3),
        ].join('\n\n');
        const res = parseStage2Response(partial, items(S1, S2, S3));
        expect(res[0].analysis).toBe(S1.a.join('\n'));
        expect(res[1].analysis).toBe(S2.a.join('\n'));
        expect(res[2].analysis).toBe(S3.a.join('\n'));
    });
});

describe('parseStage2Response — 실패/누락 처리 (안전망 유지)', () => {
    it('자기 END 마커가 아예 없으면 failed (토큰 잘림 재시도 안전망 보존)', () => {
        // S1 START+본문은 있으나 S1 END가 없음. 뒤에 S2 블록이 와도 S1은 failed로 둔다.
        const text = [openBlock(S1), block(S2)].join('\n\n');
        const res = parseStage2Response(text, items(S1, S2));
        expect(res[0]).toMatchObject({ index: 1, translation: '', analysis: '', failed: true });
        expect(res[1]).toMatchObject({ index: 2, analysis: S2.a.join('\n') }); // S2는 정상
        expect(res[1].failed).toBeUndefined();
    });

    it('자기 START 마커가 없으면 failed', () => {
        const text = block(S2); // S1 블록 자체가 없음
        const res = parseStage2Response(text, items(S1, S2));
        expect(res[0].failed).toBe(true);
        expect(res[1].failed).toBeUndefined();
    });
});

describe('parseStage2Response — 부가 필드', () => {
    it('[전사의심] 줄이 있으면 뽑고, 없으면 빈 문자열', () => {
        const withSuspect = `--- [INDEX: 1] START ---\n[번역] ${S1.tr}\n[분석] ${S1.a[0]}\n[전사의심] 오전사 의심됨\n--- [INDEX: 1] END ---`;
        const res = parseStage2Response(withSuspect, items(S1));
        expect(res[0].transcriptSuspect).toBe('오전사 의심됨');

        const res2 = parseStage2Response(block(S1), items(S1));
        expect(res2[0].transcriptSuspect).toBe('');
    });

    it('분석 청크 접두어(청크:/분석: 등)를 벗겨 원어:뜻만 남긴다', () => {
        const text = `--- [INDEX: 1] START ---\n[번역] ${S1.tr}\n[분석] 청크: Bàn ghế: 테이블과 의자\n--- [INDEX: 1] END ---`;
        const res = parseStage2Response(text, items(S1));
        expect(res[0].analysis).toBe('Bàn ghế: 테이블과 의자');
        // 상수 자체도 '청크:' 접두어를 지운다
        expect('청크: 무언가'.replace(ANALYSIS_PREFIX_STRIP, '')).toBe('무언가');
    });
});

describe('parseStage2Response — 방어적 입력', () => {
    it('text가 문자열이 아니면 전부 failed, items가 배열이 아니면 빈 배열', () => {
        expect(parseStage2Response(null, items(S1))[0].failed).toBe(true);
        expect(parseStage2Response(undefined, items(S1))[0].failed).toBe(true);
        expect(parseStage2Response('아무 텍스트', null)).toEqual([]);
        expect(parseStage2Response('아무 텍스트', undefined)).toEqual([]);
    });
});

describe('파서가 괄호 속 괄호 안전망을 거친다', () => {
    it('저장되는 analysis에서 보충 설명 괄호가 가운뎃점이 된다', () => {
        const res = parseStage2Response(
            '--- [INDEX: 3] START ---\n[번역] 쨍 쨍\n[분석] **Tằng tằng**: 쨍 쨍 (Tằng: 쨍(종소리) + tằng: 쨍)\n--- [INDEX: 3] END ---',
            [{ index: 3 }]);
        expect(res[0].analysis).toBe('**Tằng tằng**: 쨍 쨍 (Tằng: 쨍·종소리 + tằng: 쨍)');
    });
});

describe('구두점만인 청크 줄은 버린다 (2.5 Flash Lite 실측 이탈)', () => {
    it('`**?**: ?` 줄이 저장되지 않고, 글자가 있는 줄은 그대로', () => {
        const res = parseStage2Response(
            '--- [INDEX: 7] START ---\n[번역] 보통 여기서 얼마나 운동해요?\n[분석] **Bình thường**: 보통 (Bình thường: 보통)\n[분석] **bao nhiêu lâu**: 얼마나 오래 (bao nhiêu: 얼마나 + lâu: 오래)\n[분석] **?**: ?\n[분석] **,**: ,\n--- [INDEX: 7] END ---',
            [{ index: 7 }]);
        expect(res[0].analysis).toBe('**Bình thường**: 보통 (Bình thường: 보통)\n**bao nhiêu lâu**: 얼마나 오래 (bao nhiêu: 얼마나 + lâu: 오래)');
    });
    it('숫자 병기만인 청크(`**24**`)나 굵은 그냥 줄은 건드리지 않는다', () => {
        const res = parseStage2Response(
            '--- [INDEX: 1] START ---\n[번역] 24\n[분석] **hai mươi tư(24)**: 24 (hai mươi tư: 24)\n[분석] 그냥 줄: 뜻\n--- [INDEX: 1] END ---',
            [{ index: 1 }]);
        expect(res[0].analysis).toBe('**hai mươi tư(24)**: 24 (hai mươi tư: 24)\n그냥 줄: 뜻');
    });
});
