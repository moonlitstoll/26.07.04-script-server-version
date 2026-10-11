// checkAnalysisCoverage — 대본 정확도 자기 검증(비용 0).
// 원문 단어가 청크에 다 들어갔는지(규칙 9), 청크가 지나치게 뭉쳤는지 대조한다.
//
// 이 검사는 '오탐이 나면 사용자가 멀쩡한 문장을 재분석하게 되는' 성격이라 기준이 느슨하다.
// 아래 통과 케이스들은 대부분 실사용에서 오탐으로 확인돼 기준을 완화한 흔적이다 —
// 기준을 다시 조일 땐 이 케이스들이 여전히 통과하는지 반드시 확인할 것.
import { describe, it, expect } from 'vitest';
import { checkAnalysisCoverage, coverageTitle, missingWordCount, shouldAdoptMissingRetry, isLumpedAnalysis, shouldAdoptSplitRetry } from '../analysisCoverage';

// 공식 작성 예시와 같은 형식의 정상 문장
const good = {
    isAnalyzed: true,
    text: 'Mình có thêm một đứa bạn nữa để mình búng tay nó xuất hiện.',
    analysis: [
        '**Mình có thêm**: 나는 추가로 가지고 있다 (Mình: 나 + có: 가지다 + thêm: 추가로)',
        '**một đứa bạn nữa**: 친구 한 명을 더 (một: 한 개 + đứa: 명 + bạn: 친구 + nữa: 더)',
        '**để mình búng tay nó xuất hiện**: 나타나게 하기 위해',
    ].join('\n'),
};
const good2 = {
    ...good,
    analysis: good.analysis.replace('**để mình búng tay nó xuất hiện**', '**để mình búng tay**: x\n**nó xuất hiện**'),
};

describe('정상 문장은 통과한다', () => {
    it('공식 예시 형식', () => {
        expect(checkAnalysisCoverage(good)).toBeNull();
    });

    it('더 잘게 나눈 정상본', () => {
        expect(checkAnalysisCoverage(good2)).toBeNull();
    });

    it('대소문자·구두점 차이는 오탐을 내지 않는다', () => {
        expect(checkAnalysisCoverage({
            isAnalyzed: true, text: 'Trời ơi, ngon quá!',
            analysis: '**trời ơi**: 세상에\n**ngon quá**: 너무 맛있다',
        })).toBeNull();
    });

    it('원문에 반복된 단어를 청크가 한 번만 써도 오탐 없음 (집합 비교)', () => {
        expect(checkAnalysisCoverage({
            isAnalyzed: true, text: 'nhanh nhanh lên',
            analysis: '**nhanh lên**: 빨리 해 (nhanh 반복: 재촉 강조)',
        })).toBeNull();
    });
});

describe('누락 감지 (규칙 9)', () => {
    it('끝 청크가 빠지면 빠진 단어를 짚어낸다', () => {
        const missingEnd = { ...good2, analysis: good2.analysis.split('\n').slice(0, 2).join('\n') };
        const r = checkAnalysisCoverage(missingEnd);
        expect(r).not.toBeNull();
        expect(r.kind).toBe('coverage');
        expect(r.missing).toContain('để');
        expect(r.missing).toContain('hiện');
    });

    it('안내 문구에 빠진 단어와 재분석 안내가 들어간다', () => {
        const missingEnd = { ...good2, analysis: good2.analysis.split('\n').slice(0, 2).join('\n') };
        const title = coverageTitle(checkAnalysisCoverage(missingEnd));
        expect(title).toContain('để');
        expect(title).toContain('재분석');
    });
});

describe('뭉침 감지 — 기준은 10단어 이상', () => {
    // 베트남어 띄어쓰기는 음절 단위라 겹단어가 2칸으로 세어져 길이가 부풀려진다.
    // 실사용 오탐 2건 때문에 8 → 10으로 완화했다.
    it('10단어 청크는 감지한다', () => {
        const r = checkAnalysisCoverage({
            isAnalyzed: true, text: 'a b c d e f g h i j k',
            analysis: '**a b c d e f g h i j**: 뭉침(10단어)\n**k**: ok',
        });
        expect(r?.overlong).toHaveLength(1);
    });

    it('9단어 이하는 통과한다', () => {
        expect(checkAnalysisCoverage({
            isAnalyzed: true, text: 'a b c d e f g h i j',
            analysis: '**a b c d e f g h i**: 아홉\n**j**: ok',
        })).toBeNull();
    });

    it('8단어 실사용 오탐 케이스는 통과한다', () => {
        expect(checkAnalysisCoverage({
            isAnalyzed: true, text: 'no bu bu het lap hop luon nay xong',
            analysis: '**no bu bu het lap hop luon nay**: 통을 가득 채웠다\n**xong**: 끝',
        })).toBeNull();
    });

    it('문장 전체가 1청크면 감지한다', () => {
        expect(checkAnalysisCoverage({
            isAnalyzed: true, text: 'a b c d e f',
            analysis: '**a b c d e f**: 문장 전체 1청크',
        })?.overlong).toHaveLength(1);
    });

    it('짧은 문장이 1청크인 건 정상이다', () => {
        expect(checkAnalysisCoverage({
            isAnalyzed: true, text: 'ngon quá', analysis: '**ngon quá**: 맛있다',
        })).toBeNull();
    });
});

describe('숫자·기호 발음 병기 청크는 길이 검사에서 제외', () => {
    // "690.000"을 "sáu trăm chín mươi nghìn"으로 읽는 식이라 단어 수가 자연히 부풀려진다.
    it('숫자 병기 9단어 청크는 오탐을 내지 않는다', () => {
        expect(checkAnalysisCoverage({
            isAnalyzed: true,
            text: 'từ sáu trăm chín mươi nghìn(690.000) người theo dõi xong',
            analysis: '**từ sáu trăm chín mươi nghìn(690.000) người theo dõi**: 69만 팔로워로부터\n**xong**: 끝',
        })).toBeNull();
    });

    it('% 병기도 마찬가지', () => {
        expect(checkAnalysisCoverage({
            isAnalyzed: true, text: 'giảm ba mươi lăm phần trăm(35%) so với giá gốc nhé',
            analysis: '**giảm ba mươi lăm phần trăm(35%) so với giá gốc**: 정가 대비 35% 할인\n**nhé**: ~요',
        })).toBeNull();
    });

    it('괄호 원본이 한쪽에만 있어도 오탐 없음', () => {
        expect(checkAnalysisCoverage({
            isAnalyzed: true, text: 'Tổng điểm được năm phẩy sáu sáu(5,66) trên(/) mười(10).',
            analysis: '**Tổng điểm được**: 총점이 ~됐다\n**năm phẩy sáu sáu(5,66)**: 5.66\n**trên mười**: 10점 만점에 (trên(/): ~분의 + mười: 10)',
        })).toBeNull();
    });

    it('병기가 없는 10단어는 여전히 감지한다 (면제가 너무 넓지 않은지)', () => {
        expect(checkAnalysisCoverage({
            isAnalyzed: true, text: 'a b c d e f g h i j k l',
            analysis: '**a b c d e f g h i j**: 병기 없는 10단어 뭉침\n**k l**: ok',
        })?.overlong).toHaveLength(1);
    });
});

describe('검사 대상에서 제외되는 경우', () => {
    it('분석 형식이 깨진 문장은 별도 종류로 보고한다', () => {
        expect(checkAnalysisCoverage({
            isAnalyzed: true, text: 'abc', analysis: '청크 마커 없는 텍스트',
        })?.kind).toBe('no-chunks');
    });

    it('미분석 / 분석 실패 / null 은 검사하지 않는다', () => {
        expect(checkAnalysisCoverage({ isAnalyzed: false, text: 'x' })).toBeNull();
        expect(checkAnalysisCoverage({ isAnalyzed: true, analysisFailed: true, text: 'x', analysis: '**x**: y' })).toBeNull();
        expect(checkAnalysisCoverage(null)).toBeNull();
    });
});

describe('지명·이름은 1단어로 센다 (뭉침 길이)', () => {
    // 실측 오탐(휴대폰, 2026-10-09): 지명 3개가 각각 2칸으로 세어져 10칸 → 뭉침 배지.
    const text = 'Hiện tại mình đang chơi một chuyến xe từ thiện đi từ Hải Phòng đến xã Bum Tở Lai Châu với khoảng cách hơn sáu trăm(600) km.';
    const analysis = [
        '**Hiện tại mình đang chơi**: 현재 나는 운행하고 있다 (Hiện tại: 현재 + mình: 나 + đang: ~하는 중 + chơi: 놀다)',
        '**một chuyến xe từ thiện**: 자선 차량 한 대를 (một: 한 + chuyến: 편 + xe: 차 + từ thiện: 자선)',
        '**đi từ Hải Phòng đến xã Bum Tở Lai Châu**: 하이퐁에서 라이쩌우의 붐떠 면까지 가는 (đi: 가다 + từ: ~에서 + Hải Phòng: 하이퐁 + đến: ~까지 + xã: 면 + Bum Tở: 붐떠 + Lai Châu: 라이쩌우)',
        '**với khoảng cách hơn sáu trăm(600) km**: 600km가 넘는 거리로 (với: ~로 + khoảng cách: 거리 + hơn: ~넘는 + sáu trăm(600): 600 + km: 킬로미터)',
    ].join('\n');
    it('지명이 든 실측 청크는 뭉침이 아니다', () => {
        expect(checkAnalysisCoverage({ isAnalyzed: true, text, analysis })).toBeNull();
    });
    it('대문자 단어도 쉼표로 끊기면 따로 센다', () => {
        expect(checkAnalysisCoverage({
            isAnalyzed: true, text: 'Hà Nội, Sài Gòn, Đà Nẵng, Huế, Vinh, Nha Trang, Cần Thơ ok',
            analysis: '**Hà Nội, Sài Gòn, Đà Nẵng, Huế, Vinh, Nha Trang, Cần Thơ**: 도시들\n**ok**: ok',
        })?.overlong).toBeUndefined();
        expect(checkAnalysisCoverage({
            isAnalyzed: true, text: 'Hà Nội, Sài Gòn, Đà Nẵng, Huế, Vinh, Nha Trang, Cần Thơ, Hải Phòng, Đà Lạt, Sa Pa ok',
            analysis: '**Hà Nội, Sài Gòn, Đà Nẵng, Huế, Vinh, Nha Trang, Cần Thơ, Hải Phòng, Đà Lạt, Sa Pa**: 도시 10곳\n**ok**: ok',
        })?.overlong).toHaveLength(1);
    });
});

describe('과분할 감지 (2026-10, 2.5 Flash Lite 실측)', () => {
    it('구두점만인 청크가 있으면 과분할', () => {
        const r = checkAnalysisCoverage({
            isAnalyzed: true, text: 'Bình thường cô tập ở đây bao nhiêu lâu?',
            analysis: '**Bình thường**: 보통 (Bình thường: 보통)\n**cô tập**: 당신은 운동하다 (cô: 당신 + tập: 운동하다)\n**ở đây**: 여기서 (ở: ~에 + đây: 여기)\n**bao nhiêu lâu**: 얼마나 오래 (bao nhiêu: 얼마나 + lâu: 오래)\n**?**: ?',
        });
        expect(r?.oversplit?.punct).toBe(1);
        expect(coverageTitle(r)).toContain('구두점만 있는 청크 1개');
    });
    it('휴대폰 실측: 33단어가 16청크(구두점 제외)로 쪼개지면 과분할', () => {
        const text = 'Cảm ơn những con người tuyệt vời không ngại khó khăn đã dành thời gian, công sức, tiền bạc để giúp đỡ những mảnh đời kém may mắn nơi rừng núi hiểm trở.';
        const chunks = ['Cảm ơn', 'những con người', 'tuyệt vời', 'không ngại', 'khó khăn', 'đã dành', 'thời gian', 'công sức', 'tiền bạc', 'để', 'giúp đỡ', 'những mảnh đời', 'kém may mắn', 'nơi', 'rừng núi', 'hiểm trở'];
        const r = checkAnalysisCoverage({ isAnalyzed: true, text, analysis: chunks.map(c => `**${c}**: 뜻`).join('\n') });
        expect(r?.oversplit).toEqual({ punct: 0, chunks: 16, words: 33 });
        expect(coverageTitle(r)).toContain('너무 잘게 쪼개짐');
    });
    it('정상 분할(33단어 8청크)과 가벼운 분할(7단어 4청크)은 잡지 않는다', () => {
        const text = 'Cảm ơn những con người tuyệt vời không ngại khó khăn đã dành thời gian, công sức, tiền bạc để giúp đỡ những mảnh đời kém may mắn nơi rừng núi hiểm trở.';
        const ok = ['Cảm ơn những con người tuyệt vời', 'không ngại khó khăn', 'đã dành thời gian', 'công sức, tiền bạc', 'để giúp đỡ những mảnh đời', 'kém may mắn', 'nơi rừng núi hiểm trở'];
        expect(checkAnalysisCoverage({ isAnalyzed: true, text, analysis: ok.map(c => `**${c}**: 뜻`).join('\n') })).toBeNull();
        expect(checkAnalysisCoverage({
            isAnalyzed: true, text: 'Nên bạn nào sợ thì đi về nhá.',
            analysis: '**Nên bạn nào**: 그러니 누구든\n**sợ**: 무서워하면\n**thì đi về**: 집에 가\n**nhá**: ~해',
        })).toBeNull();
    });
});

describe('누락 재시도 채택 규칙 (shouldAdoptMissingRetry)', () => {
    // 실측(Circle K #37): "Và đó chính là quán nét." → 모델이 `quán nét` 청크를 건너뜀
    const text = 'Và đó chính là quán nét.';
    const prev = '**Và đó**: 그리고 그것 (Và: 그리고 + đó: 그것)\n**chính là**: 바로 ~이다 (chính: 바로 + là: ~이다)';
    const full = prev + '\n**quán nét**: PC방 (quán: 가게 + nét: 인터넷)';
    it('빠진 단어가 줄면 채택', () => {
        expect(missingWordCount(text, prev)).toBe(2);
        expect(missingWordCount(text, full)).toBe(0);
        expect(shouldAdoptMissingRetry(text, prev, full)).toBe(true);
    });
    it('빠진 단어가 같거나 늘면 거부 (퇴행 방지)', () => {
        expect(shouldAdoptMissingRetry(text, prev, prev)).toBe(false);
        expect(shouldAdoptMissingRetry(text, prev, '**Và đó**: 그리고 그것 (Và: 그리고 + đó: 그것)')).toBe(false);
    });
    it('문장 전체를 1청크로 뭉친 결과는 빠진 단어 0이어도 거부, 빈 결과도 거부', () => {
        const long = 'Và mong rằng sẽ không bị nhân viên phát hiện.';
        const partial = '**Và mong rằng**: 바라건대\n**nhân viên phát hiện**: 직원이 발견하다';
        expect(shouldAdoptMissingRetry(long, partial, '**Và mong rằng sẽ không bị nhân viên phát hiện**: 직원에게 안 들키길')).toBe(false);
        expect(shouldAdoptMissingRetry(long, partial, '')).toBe(false);
        expect(shouldAdoptMissingRetry(long, partial, '**Và mong rằng**: 바라건대\n**sẽ không bị**: ~당하지 않다\n**nhân viên phát hiện**: 직원이 발견하다')).toBe(true);
    });
});

describe('뭉침 자동 재분할 판정 (isLumpedAnalysis, 2026-10-11)', () => {
    // 실측(4번 영상 v4a #95, 1차 분석 그대로). 옛 기준은 단어 '집합'으로 세어 `**Màu xanh**`가 86%를 덮는다고 봤다.
    const MAU = 'Màu xanh, màu xanh, ôi màu xanh.';
    const MAU_A = '**Màu xanh**: 파란색 (Màu xanh: 파란색)\n**màu xanh**: 파란색 (màu xanh: 파란색)\n**ôi màu xanh**: 오, 파란색 (ôi: 오·감탄사 + màu xanh: 파란색)';

    it('같은 말이 되풀이되는 문장을 잘게 나눈 것은 뭉침이 아니다', () => {
        expect(isLumpedAnalysis(MAU, MAU_A)).toBe(false);
    });

    it('규칙 13대로 2~4단어씩 나눈 짧은 문장은 뭉침이 아니다 (6단어를 4+2로)', () => {
        expect(isLumpedAnalysis('Bắt tay vào làm luôn nào.', '**Bắt tay vào làm**: 착수하다 (Bắt tay: 손잡다 + vào làm: 일하다)\n**luôn nào**: 바로 하자 (luôn: 바로 + nào: ~하자)')).toBe(false);
    });

    it('숫자 병기 괄호는 단어로 세지 않는다 (실제 5단어 문장의 1청크는 정상)', () => {
        expect(isLumpedAnalysis('Phải đến năm(5) phút rồi.', '**Phải đến năm(5) phút rồi**: 5분은 됐다 (Phải: ~해야 + đến: ~까지 + năm(5): 5 + phút: 분 + rồi: 이미)')).toBe(false);
    });

    it('6단어 이상 문장을 통째로 1청크로 낸 것은 뭉침', () => {
        expect(isLumpedAnalysis('Các bạn nhìn thấy gì không?', '**Các bạn nhìn thấy gì không?**: 뭐가 보여요? (Các bạn: 여러분 + nhìn thấy: 보다 + gì: 무엇 + không: ~나요)')).toBe(true);
    });

    it('6단어 이상인 청크가 문장의 60% 이상이면 뭉침 (실측 v4a #18, 13단어 중 8단어)', () => {
        const t = 'Dứt điểm hộp sữa chua rồi mình đi đến Circle K tiếp theo.';
        const a = '**Dứt điểm hộp sữa chua**: 요거트 통을 다 비우고 (Dứt điểm: 끝내다 + hộp: 통 + sữa chua: 요거트)\n**rồi mình đi đến Circle K tiếp theo**: 그리고 다음 Circle K로 갔어요 (rồi: 그리고 + mình: 나 + đi đến: 가다 + Circle K: Circle K + tiếp theo: 다음)';
        expect(isLumpedAnalysis(t, a)).toBe(true);
    });

    it('6단어 미만 문장은 판정하지 않는다', () => {
        expect(isLumpedAnalysis('Ngon vãi luôn các bạn.', '**Ngon vãi luôn các bạn**: 진짜 맛있어 여러분 (Ngon: 맛있다 + vãi luôn: 엄청 + các bạn: 여러분)')).toBe(false);
    });
});

describe('뭉침 재분할 채택 규칙 (shouldAdoptSplitRetry, 2026-10-11)', () => {
    const T18 = 'Dứt điểm hộp sữa chua rồi mình đi đến Circle K tiếp theo.';
    const A18 = '**Dứt điểm hộp sữa chua**: 요거트 통을 다 비우고 (Dứt điểm: 끝내다 + hộp: 통 + sữa chua: 요거트)\n**rồi mình đi đến Circle K tiếp theo**: 그리고 다음 Circle K로 갔어요 (rồi: 그리고 + mình: 나 + đi đến: 가다 + Circle K: Circle K + tiếp theo: 다음)';

    it('풀이를 유지한 채 잘게 나눈 답은 채택 (실측 v4a #18 강제 분할 응답)', () => {
        const next = '**Dứt điểm**: 끝내다·마무리하다 (Dứt điểm: 끝내다)\n**hộp sữa chua**: 요거트 통 (hộp: 통·상자 + sữa chua: 요거트)\n**rồi mình đi**: 그리고 나는 간다 (rồi: 그리고·완료 + mình: 나 + đi: 가다)\n**đến Circle K**: Circle K에 (đến: ~에 도착하다 + Circle K: Circle K)\n**tiếp theo**: 다음 (tiếp theo: 다음)';
        expect(shouldAdoptSplitRetry(T18, A18, next)).toBe(true);
    });

    it('줄 수만 늘고 단어 풀이가 빠진 답은 거부 (실측 2번 영상 #133 3라운드 응답)', () => {
        const t = 'Thực sự rất là kinh khủng.';
        const prev = '**Thực sự**: 정말 (Thực sự: 정말)\n**rất là kinh khủng**: 아주 끔찍하네요 (rất: 매우 + là: ~이다 + kinh khủng: 끔찍하다)';
        const next = '**Thực sự**: 정말로\n**rất là**: 아주\n**kinh khủng**: 끔찍하다';
        expect(shouldAdoptSplitRetry(t, prev, next)).toBe(false);
    });

    it('원문 단어를 빠뜨린 답은 거부', () => {
        const next = '**Dứt điểm**: 끝내다 (Dứt điểm: 끝내다)\n**hộp sữa chua**: 요거트 통 (hộp: 통 + sữa chua: 요거트)\n**tiếp theo**: 다음 (tiếp theo: 다음)';
        expect(shouldAdoptSplitRetry(T18, A18, next)).toBe(false);
    });

    it('여전히 뭉쳤고 가장 큰 청크도 그대로면 거부', () => {
        const next = '**Dứt điểm**: 끝내다 (Dứt điểm: 끝내다)\n**hộp sữa chua**: 요거트 통 (hộp: 통 + sữa chua: 요거트)\n**rồi mình đi đến Circle K tiếp theo**: 다음 Circle K로 갔어요 (rồi: 그리고 + mình: 나 + đi đến: 가다 + Circle K: Circle K + tiếp theo: 다음)';
        expect(shouldAdoptSplitRetry(T18, A18, next)).toBe(false);
    });

    it('빈 답·청크 없는 답은 거부', () => {
        expect(shouldAdoptSplitRetry(T18, A18, '')).toBe(false);
        expect(shouldAdoptSplitRetry(T18, A18, '그냥 문장')).toBe(false);
    });
});
