# 04. 시뮬레이션 물리 규칙

**문서 목적**: 입자 시뮬레이션의 수학적·물리적 규칙을 정의한다. 구현의 기준이 된다.

---

## 핵심 설계 철학

**"센서 측정값은 시뮬레이션의 1차 물리량(속도 등)에 즉시 반영하고, 2차 물리량(부피, 평형 등)은 물리적 인과 과정을 보여주며 지연 수렴한다."**

공식의 결과값을 즉시 반영하는 것이 아니라, **학생이 인과 과정을 시각적으로 볼 수 있도록** 시뮬레이션의 시간 전개를 설계한다.

---

## 공통 규칙

### 입자 표현

- **종류**: `Particle` 클래스의 인스턴스. 속성: `{type, position, velocity, radius, color}`
- **개수**: 기본 200~300개. 설정 파일로 조정 가능.
- **스케일 축약**: 실제 분자 수(10²³)는 시각화 불가. 화면은 "대표 영역"이며, 학생에게 이 점을 UI에서 명시.

### 속도 분포: 맥스웰-볼츠만

모든 입자가 같은 속도가 아니라 **정규분포 난수**를 이용해 맥스웰-볼츠만 분포를 따르게 한다.

**구현 방식**:

```javascript
function gaussianRandom() {
  // Box-Muller 변환
  const u1 = Math.random();
  const u2 = Math.random();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

function initParticleVelocity(particle, temperature) {
  const sigma = Math.sqrt(temperature / reference_temperature);
  particle.velocity.x = gaussianRandom() * sigma * base_speed;
  particle.velocity.y = gaussianRandom() * sigma * base_speed;
}
```

각 입자의 속도 성분 $v_x$, $v_y$가 독립적 정규분포를 따르면, 속도 크기 $|\vec{v}| = \sqrt{v_x^2 + v_y^2}$ 가 자동으로 맥스웰-볼츠만 분포를 따른다.

**시각화 보조**: 입자 색이나 꼬리 길이를 속도에 비례시켜 "빠른 분자"와 "느린 분자"를 구분 표시. 빨간색-긴꼬리가 빠른 입자, 파란색-짧은꼬리가 느린 입자.

### 벽 충돌

단순 탄성 충돌:

```
if (particle.x < 0 || particle.x > box_width) {
  particle.velocity.x *= -1;
  particle.x = clamp(particle.x, 0, box_width);
}
// y축도 동일
```

### 입자 간 충돌

- **v1에서는 생략**. 입자가 서로 뚫고 지나감.
- v2 확장 시 단순 구-구 충돌 구현 가능.

---

## 시간 축 처리

### 프레임 기반 업데이트

- 기본 프레임 레이트: 60Hz (requestAnimationFrame)
- 각 프레임에서 `dt`는 실제 경과 시간 (보통 약 16.67ms)
- `dt`를 이용해 속도·위치 갱신, 프레임 레이트에 무관한 일관성 유지

### 지수 수렴 공식

시뮬레이션의 어떤 값 `current`를 목표값 `target`으로 점진적으로 수렴시킬 때:

```
current += (target - current) * (dt / tau)
```

- `tau`: 시정수 (time constant). 단위는 초.
- `tau` 작을수록 빠르게 수렴, 클수록 느리게.
- 63% 수렴 시간 = tau, 95% 수렴 시간 ≈ 3·tau

**기본값 (설정 파일에서 조정)**:
- 입자 속도 수렴: `velocity_tau = 0.05초` (거의 즉시)
- 박스 부피 수렴: `volume_tau = 0.5초` (인과가 보일 정도)

---

## 보일 법칙 (장비 A)

### 입력

- **학생 조작**: 주사기 부피 $V_{input}(t)$ (학생이 UI에 입력)
- **센서 측정**: 압력 $P_{sensor}(t)$ (검증용)

### 시뮬레이션 상태 갱신

**온도**: 일정. 입자 속도 변화 없음.

**박스 크기**: 학생 입력 부피를 즉시 반영.
```
box_width = V_input / box_height  (또는 사각형 비율 유지)
```

**입자 수**: 고정 (몰수 일정).

**입자 밀도**: 박스 축소에 따라 자동 증가.

**시각화 효과**: 
- 박스가 좁아짐 → 입자 간 거리 줄어듦 → 벽 충돌 빈도 자연 증가
- 벽에 충돌할 때 벽이 순간 밝게 빛나는 효과 (충돌 시각화)
- "예측 vs 실측" 패널: 이상기체 예측값 $P_{ideal} = P_0 V_0 / V$ 와 $P_{sensor}$를 나란히 표시

### 지연 처리

- **없음**. 보일 법칙에서 압력 변화는 물리적으로 거의 즉시 일어나므로.
- 단, 센서 값은 이동 평균 스무딩으로 시각적 안정성 확보.

---

## 샤를 법칙 (장비 B)

### 입력

- **센서 측정**: 온도 $T_{sensor}(t)$ (주 입력)
- **학생 수동**: 부피 $V_{input}$ (초기값 확인용, 추후 실시간 입력도 가능)

### 시뮬레이션 상태 갱신

**온도 (즉시 반영)**:
```
T_sim = lerp(T_sim, T_sensor, dt / velocity_tau)  
// velocity_tau = 0.05초 → 거의 즉시 추종
```

**입자 속도 스케일링 (즉시 반영)**:
```
speed_ratio = sqrt(T_sim / T_prev)
for each particle:
  particle.velocity *= speed_ratio
T_prev = T_sim
```

**목표 부피 계산**:
```
V_target = V_0 * (T_sim / T_0)
```

**박스 크기 지연 수렴**:
```
V_current += (V_target - V_current) * (dt / volume_tau)
// volume_tau = 0.5초
box_width = V_current / box_height
```

### 시각화 효과

학생 경험:
1. 온도 센서 값이 올라감 (수조에 담근 후 서서히)
2. **즉시**: 입자들이 눈에 띄게 빨라짐 (색이 더 빨갛게, 꼬리 길어짐)
3. **지연 수렴**: 박스가 천천히 팽창하기 시작
4. 빨라진 입자가 벽에 부딪혀 "밀어내는 것처럼" 보임
5. 박스가 새 평형 크기에 도달
6. 온도 변화가 멈추면 입자 속도·박스 크기 모두 안정

### 지연 처리의 핵심

- 입자 속도 수렴이 **빠르고**, 박스 부피 수렴이 **느리다**.
- 이 속도 차이가 "속도 변화 → 부피 변화"의 **인과 순서**를 시각적으로 만든다.
- `velocity_tau : volume_tau = 1 : 10` 비율이 현재 기본값. 조정 가능.

---

## 산염기 실험 (설계 예정)

pH 센서 기반 이온화 시각화의 물리 규칙은 추후 별도 문서에서 정의. 예상되는 구조:

- 센서 pH 즉시 반영
- 이온 개수 분포는 Ka 값으로 계산 (강산: 완전 이온화, 약산: 부분 이온화)
- 평형 상태 전이는 지수 수렴으로 시각화 (동적 평형 애니메이션)
- 온도 변화 시 평형 이동(르샤틀리에): 수렴 과정이 시간 지연으로 표현

---

## 튜닝 가능한 파라미터 목록

모두 `web/config/simulation.json`에 저장되어 실행 중 수정 가능:

| 파라미터 | 기본값 | 설명 |
|---|---|---|
| particle_count | 250 | 화면에 그려지는 입자 수 |
| particle_radius | 4 | 입자 반지름 (픽셀) |
| velocity_tau | 0.05 | 입자 속도 수렴 시정수 (초) |
| volume_tau | 0.5 | 박스 부피 수렴 시정수 (초) |
| pressure_smooth_window | 5 | 압력 센서 이동평균 윈도우 |
| temperature_smooth_window | 10 | 온도 센서 이동평균 윈도우 |
| reference_temperature_K | 293.15 | 기준 온도 (실온 20°C) |
| show_velocity_color | true | 속도에 따른 입자 색 변화 |
| show_collision_flash | true | 벽 충돌 시각 효과 |
| box_aspect_ratio | 1.5 | 박스 가로세로 비율 |

## 구현 체크리스트

### v1 필수 기능

- [ ] Particle 클래스 (맥스웰-볼츠만 초기 속도)
- [ ] ParticleSystem 클래스 (벽 충돌 포함)
- [ ] Renderer 클래스 (속도별 색상)
- [ ] 지수 수렴 유틸리티 함수
- [ ] 보일 실험 모드 구현
- [ ] 샤를 실험 모드 구현
- [ ] 설정 파일 로딩
- [ ] 프레임 레이트 독립적 dt 처리

### v2 확장 기능 (필요 시)

- [ ] 입자 간 충돌
- [ ] 반데르발스 편차 모드
- [ ] 고급 시각화 (히트맵, 속도 분포 그래프)
- [ ] 물리 엔진 기반 정밀 시뮬레이션
