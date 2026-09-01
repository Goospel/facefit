import { ui } from '../ui';
import { LOCAL_ONLY } from './usePhotos';

/**
 * 온보딩 — **한 화면, 스와이프 없음.**
 *
 * 담는 것은 검수와 사용자 양쪽에 필요한 최소 셋이다(설계 §5-5): 무엇을 하는 앱인가 ·
 * 어떻게 찍어야 비교가 되는가 · 사진과 카메라 권한을 어떻게 다루는가.
 *
 * ⚠️ **문구 규율**(설계 §6): 어디서도 「효과가 있다/좋아진다」를 단정하지 않는다.
 * 이 앱은 관찰을 돕는 도구지 판정하는 도구가 아니고, 단정은 사실이 아닌 데다 검수에서도
 * 근거를 요구받는다.
 *
 * ⚠️ **카메라 권한 프롬프트가 뜨기 전에** 목적을 말해 둔다 — 프롬프트가 먼저 뜨면
 * 「왜 필요한가」에 답하는 문장이 화면에 없다.
 *
 * 예시 타임랩스 일러스트는 v1 보류다 — 번들 자산 제작 비용 대비 검증 안 된 가설이다.
 */
export function Onboarding({
  onDone,
  onRestore,
}: {
  onDone: () => void;
  /**
   * 기기 이전 복원(v3 §3-4). **없으면 링크 자체가 없다** — 쓸 수 없는 기기(구버전 토스)에서
   * 링크만 남기면 「눌렀는데 아무 일도 없다」가 된다. 그 판단은 App이 한다.
   *
   * 자리가 여기인 이유: 새 기기의 첫 화면이 온보딩이라 **복원을 떠올릴 유일한 순간**이다.
   * Home으로 내리면 이미 「새로 시작한」 상태와 섞인다.
   */
  onRestore?: () => void;
}) {
  return (
    <main style={ui.pageFull}>
      <h1 style={{ ...ui.h1, marginTop: 24 }}>그화장품효과있나</h1>

      <div style={{ display: 'grid', gap: 20, marginTop: 8 }}>
        <Step
          title="매일 한 장"
          body="매일 같은 각도로 찍어, 화장품을 쓰는 동안 얼굴이 어떻게 달라지는지 관찰해요."
        />
        <Step
          title="같은 조건으로"
          body="아침 세안 직후, 지난 사진에 얼굴을 겹쳐 찍으면 비교가 정확해져요."
        />
        <div>
          <b style={{ fontSize: 15 }}>이 기기에만</b>
          {/* ⚠️ 검수 통과 문장이라 **한 줄 그대로** 둔다 — 다른 문장에 섞어 넣으면
              화면마다 미묘하게 달라지고, 그때부터 「어느 쪽이 사실인가」가 된다. */}
          <p style={{ ...ui.sub, margin: '4px 0 0' }}>{LOCAL_ONLY}</p>
          <p style={{ ...ui.sub, margin: '4px 0 0' }}>
            카메라는 얼굴 사진을 찍는 데에만 쓰고, 계정도 서버도 없어요.
          </p>
          {/* ⚠️ v2-2에서 「런타임 네트워크 호출 0」이 처음 깨진다(설계 §3-5). 위 문장은 사진
              이야기라 여전히 참이지만, 그것만 두면 **부분적으로 낡은 고지**가 된다 — 검수자가
              번들에서 호출을 발견하고 묻기 전에 우리가 먼저 말한다. */}
          <p style={{ ...ui.sub, margin: '4px 0 0' }}>
            제품을 검색할 때만 식약처 공공 데이터를 조회해요. 나가는 건 검색어뿐이에요.
          </p>
        </div>
      </div>

      <span style={ui.spacer} />

      <div style={ui.stickyFooter}>
        <button style={ui.primary} onClick={onDone}>
          시작하기
        </button>
        {onRestore && (
          <button style={{ ...ui.ghost, width: '100%', marginTop: 8 }} onClick={onRestore}>
            기기를 바꿨나요? 기록 복원
          </button>
        )}
      </div>
    </main>
  );
}

function Step({ title, body }: { title: string; body: string }) {
  return (
    <div>
      <b style={{ fontSize: 15 }}>{title}</b>
      <p style={{ ...ui.sub, margin: '4px 0 0' }}>{body}</p>
    </div>
  );
}
