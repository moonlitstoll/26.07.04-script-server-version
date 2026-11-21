import { describe, it, expect } from 'vitest';
import { makeRemap, remapIndex, remapIndices } from '../lineAnchors';

const S = (seconds, text) => ({ seconds, text });
const a = S(1, 'a'); const b = S(3, 'b'); const c = S(9, 'c'); const d = S(12, 'd');

describe('문장 번호 따라가기', () => {
    it('대본이 그대로면 번호도 그대로, 범위 밖은 null', () => {
        const data = [a, b, c];
        expect(remapIndex(data, data, 1)).toBe(1);
        expect(remapIndex(data, data, 5)).toBe(null);
        expect(remapIndex(data, data, -1)).toBe(null);
    });

    it('앞에 문장이 돌아오면(실행취소) 한 칸 밀린 같은 문장을 가리킨다 — 화면 재현 건', () => {
        // a를 지운 대본에서 1번(c)을 골랐는데 a가 돌아옴
        expect(remapIndex([b, c, d], [a, b, c, d], 1)).toBe(2);
    });

    it('앞 문장을 지우면 한 칸 당겨진 같은 문장을 가리킨다', () => {
        expect(remapIndex([a, b, c, d], [b, c, d], 2)).toBe(1);
    });

    it('그 문장이 지워졌으면 null (옆 문장으로 넘어가지 않는다)', () => {
        expect(remapIndex([a, b, c, d], [a, c, d], 1)).toBe(null);
        expect(remapIndex([a, b, c], [a, b], 2)).toBe(null);
        expect(remapIndex([a, b, c], [b, c], 0)).toBe(null);
    });

    it('문장 객체가 새로 만들어져도(저장본 다시 읽기) 시각·글자가 같으면 같은 문장', () => {
        const again = [a, b, c].map(x => ({ ...x, translation: '번역' }));
        expect(remapIndices([a, b, c], again, [0, 2])).toEqual([0, 2]);
    });

    it('제자리에서 글자만 바뀐 문장(다시 전사 1→1)은 같은 자리로 본다', () => {
        expect(remapIndex([a, b, c], [a, S(3, 'b 고침'), c], 1)).toBe(1);
        // 시각이 조금 옮겨져도 앞뒤 문장 사이 수가 그대로면 같은 자리
        expect(remapIndex([a, b, c], [a, S(3.4, 'b 고침'), c], 1)).toBe(1);
        // 맨 앞·맨 뒤도
        expect(remapIndex([a, b, c], [S(1, 'a 고침'), b, c], 0)).toBe(0);
        expect(remapIndex([a, b, c], [a, b, S(9, 'c 고침')], 2)).toBe(2);
    });

    it('다른 곳에서 문장 수가 같이 바뀌어도 제자리 문장을 찾는다', () => {
        // c가 고쳐지는 동안 a가 지워짐
        expect(remapIndex([a, b, c, d], [b, S(9, 'c 고침'), d], 2)).toBe(1);
        // 바로 옆이 같이 바뀌어 어느 것인지 가릴 수 없으면 null (b가 고쳐지는 동안 a가 지워짐)
        expect(remapIndex([a, b, c], [S(3, 'b 고침'), c], 1)).toBe(null);
    });

    it('한 문장이 둘로 늘었으면 어느 쪽인지 알 수 없으니 null', () => {
        expect(remapIndex([a, b, c], [a, S(3, 'b1'), S(4, 'b2'), c], 1)).toBe(null);
    });

    it('똑같은 문장이 둘이면 앞에서부터 순서로 짝짓는다', () => {
        const x1 = S(5, 'x'); const x2 = S(5, 'x');
        expect(remapIndices([x1, x2, c], [a, x1, x2, c], [0, 1])).toEqual([1, 2]);
        // 둘 중 하나가 지워지면 남은 하나는 앞의 것으로 본다
        expect(remapIndices([x1, x2, c], [x2, c], [0, 1, 2])).toEqual([0, 1]);
    });

    it('여러 번호: 없어진 것만 빠진다', () => {
        expect(remapIndices([a, b, c, d], [a, c, d], [0, 1, 3])).toEqual([0, 2]);
        expect(remapIndices([a, b], [], [0, 1])).toEqual([]);
    });

    it('대본이 아니면 전부 null', () => {
        expect(makeRemap(null, [a])(0)).toBe(null);
        expect(makeRemap([a], undefined)(0)).toBe(null);
    });
});
