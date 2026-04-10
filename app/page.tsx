"use client";

import Link from "next/link";

const attractions = [
  {
    title: "Pattern Calculator",
    description: "요크 패턴 계산기로 들어가기",
    href: "/pattern",
    style: {
      top: "66%",
      left: "76%",
      rotate: "-13deg",
      width: "156px",
      height: "210px",
    },
    kind: "calculator",
  },
  {
    title: "Yarn Booth",
    description: "추가 기능 예정",
    href: "#",
    style: {
      top: "47%",
      left: "16%",
      rotate: "-10deg",
      width: "128px",
      height: "124px",
    },
    kind: "yarn",
  },
  {
    title: "Bookshelf",
    description: "아카이브 예정",
    href: "#",
    style: {
      top: "38%",
      left: "84%",
      rotate: "2deg",
      width: "116px",
      height: "186px",
    },
    kind: "books",
  },
  {
    title: "Beer Hall",
    description: "이벤트 예정",
    href: "#",
    style: {
      top: "73%",
      left: "47%",
      rotate: "-2deg",
      width: "112px",
      height: "156px",
    },
    kind: "beer",
  },
];

export default function HomePage() {
  return (
    <main style={styles.page}>
      <div style={styles.skyGlow} />
      <div style={styles.gridTexture} />

      <header style={styles.header}>
        <div style={styles.familyBadge}>
          <div style={styles.familyBlob} />
          <div style={styles.familyBlobSmall} />
        </div>
        <div style={styles.titleWrap}>
          <div style={styles.logoSquiggle}>@</div>
          <div style={styles.logoPlate}>yooth&apos;s knitting funpark</div>
          <div style={styles.logoDoodleLeft}>☾</div>
          <div style={styles.logoDoodleRight}>✩</div>
        </div>
      </header>

      <section style={styles.hero}>
        <div style={styles.hillBack} />
        <div style={styles.hillMid} />
        <div style={styles.hillFront} />
        <div style={styles.tunnel} />
        <div style={styles.road} />
        <div style={styles.centerPortal}>
          <div style={styles.centerPortalInner}>
            <div style={styles.portalField} />
            <div style={styles.portalHouse} />
          </div>
        </div>

        <div style={styles.flowerClusterLeft}>
          <span style={styles.flower}>✿</span>
          <span style={{ ...styles.flower, marginLeft: 38, marginTop: 34 }}>✿</span>
        </div>
        <div style={styles.flowerClusterRight}>
          <span style={styles.flower}>❀</span>
          <span style={{ ...styles.flower, marginLeft: 44, marginTop: 18 }}>❀</span>
        </div>

        {attractions.map((item) => {
          const sharedStyle = {
            ...styles.attraction,
            top: item.style.top,
            left: item.style.left,
            rotate: item.style.rotate,
            width: item.style.width,
            height: item.style.height,
          } as const;

          if (item.href === "/pattern") {
            return (
              <Link key={item.title} href={item.href} style={{ ...sharedStyle, ...styles.attractionInteractive }}>
                <AttractionArt kind={item.kind} />
                <span style={styles.attractionLabel}>
                  <strong>{item.title}</strong>
                  <span>{item.description}</span>
                </span>
              </Link>
            );
          }

          return (
            <div key={item.title} style={{ ...sharedStyle, ...styles.attractionStatic }}>
              <AttractionArt kind={item.kind} />
            </div>
          );
        })}
      </section>

      <section style={styles.introPanel}>
        <div style={styles.introEyebrow}>Main Hall</div>
        <h1 style={styles.introTitle}>뜨개 패턴 계산 기능을 놀이공원 오브젝트처럼 배치한 메인 페이지</h1>
        <p style={styles.introText}>
          지금은 계산기 오브젝트를 누르면 기존 요크 패턴 생성기 화면으로 들어갑니다. 다른 오브젝트는 이후 기능 확장을 위한
          자리입니다.
        </p>
        <div style={styles.introActions}>
          <Link href="/pattern" style={styles.primaryLink}>
            계산기 열기
          </Link>
          <span style={styles.secondaryHint}>Figma 상세값을 받으면 이 메인 화면은 더 정밀하게 맞출 수 있습니다.</span>
        </div>
      </section>
    </main>
  );
}

function AttractionArt({ kind }: { kind: string }) {
  if (kind === "calculator") {
    return (
      <div style={{ ...styles.objectCard, ...styles.calculatorShell }}>
        <div style={styles.calculatorScreen}>yooth</div>
        <div style={styles.calculatorKeys}>
          {Array.from({ length: 16 }, (_, i) => (
            <span key={i} style={styles.calculatorKey} />
          ))}
        </div>
      </div>
    );
  }

  if (kind === "yarn") {
    return (
      <div style={{ ...styles.objectCard, ...styles.yarnSpool }}>
        <div style={styles.yarnCore} />
      </div>
    );
  }

  if (kind === "books") {
    return (
      <div style={{ ...styles.objectCard, ...styles.bookStack }}>
        {Array.from({ length: 8 }, (_, i) => (
          <span
            key={i}
            style={{
              ...styles.book,
              background: bookColors[i % bookColors.length],
              transform: `translateX(${(i % 2) * 3}px)`,
            }}
          />
        ))}
      </div>
    );
  }

  return (
    <div style={{ ...styles.objectCard, ...styles.beerMug }}>
      <div style={styles.beerFoam} />
      <div style={styles.beerHandle} />
    </div>
  );
}

const bookColors = ["#f6d59b", "#7ec1dd", "#d3a884", "#f28e68", "#9db781", "#ccc7f5"];

const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: "100vh",
    position: "relative",
    overflow: "hidden",
    color: "#08100a",
    background:
      "linear-gradient(180deg, #9dc4d8 0%, #bfd7d2 28%, #afc98d 49%, #89a34a 70%, #6d8326 100%)",
  },
  skyGlow: {
    position: "absolute",
    inset: 0,
    background:
      "radial-gradient(circle at 30% 22%, rgba(255,255,255,0.72) 0%, rgba(255,255,255,0.08) 24%, rgba(255,255,255,0) 55%)",
    pointerEvents: "none",
  },
  gridTexture: {
    position: "absolute",
    inset: 0,
    backgroundImage:
      "linear-gradient(rgba(255,255,255,0.08) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.08) 1px, transparent 1px)",
    backgroundSize: "28px 28px",
    opacity: 0.18,
    mixBlendMode: "soft-light",
    pointerEvents: "none",
  },
  header: {
    position: "relative",
    zIndex: 2,
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    padding: "34px 36px 0",
  },
  familyBadge: {
    position: "relative",
    width: 108,
    height: 108,
    borderRadius: "28px",
    background: "rgba(255,255,255,0.82)",
    border: "6px solid #ffffff",
    boxShadow: "0 18px 40px rgba(0,0,0,0.14)",
    rotate: "-8deg",
  },
  familyBlob: {
    position: "absolute",
    inset: 18,
    borderRadius: "20px",
    background: "linear-gradient(180deg, #4f4f4f 0%, #111111 100%)",
    filter: "contrast(1.1)",
  },
  familyBlobSmall: {
    position: "absolute",
    width: 34,
    height: 22,
    left: 30,
    bottom: -8,
    borderRadius: 999,
    background: "#2d2d2d",
    border: "5px solid #fff",
  },
  titleWrap: {
    position: "relative",
    width: "min(760px, 70vw)",
    marginRight: "14vw",
  },
  logoSquiggle: {
    position: "absolute",
    top: -22,
    left: "43%",
    color: "#ffffff",
    fontSize: 64,
    fontWeight: 700,
    fontFamily: "cursive",
  },
  logoPlate: {
    display: "inline-block",
    padding: "10px 28px 12px",
    background: "#050505",
    color: "#ffffff",
    fontSize: "clamp(2rem, 4.6vw, 4.6rem)",
    lineHeight: 1.05,
    fontFamily: '"Brush Script MT", "Marker Felt", cursive',
    rotate: "-4deg",
    boxShadow: "0 18px 50px rgba(0,0,0,0.22)",
  },
  logoDoodleLeft: {
    position: "absolute",
    left: 40,
    bottom: -34,
    color: "#ffffff",
    fontSize: 60,
    rotate: "-14deg",
  },
  logoDoodleRight: {
    position: "absolute",
    right: -90,
    top: 20,
    color: "#ffffff",
    fontSize: 54,
    rotate: "12deg",
  },
  hero: {
    position: "relative",
    minHeight: "74vh",
    marginTop: 8,
  },
  hillBack: {
    position: "absolute",
    inset: "32% -4% 8% -4%",
    background:
      "radial-gradient(circle at 24% 38%, rgba(255,255,255,0.34) 0%, transparent 18%), linear-gradient(180deg, #97ba54 0%, #759436 100%)",
    borderTopLeftRadius: "50% 28%",
    borderTopRightRadius: "42% 26%",
  },
  hillMid: {
    position: "absolute",
    left: "12%",
    right: "12%",
    bottom: "7%",
    height: "42%",
    background: "linear-gradient(180deg, #87aa38 0%, #6d8525 100%)",
    borderTopLeftRadius: "34% 48%",
    borderTopRightRadius: "30% 44%",
    borderBottomLeftRadius: "26% 20%",
    borderBottomRightRadius: "26% 20%",
    transform: "skewX(-8deg)",
  },
  hillFront: {
    position: "absolute",
    inset: "58% -4% -8% -4%",
    background: "linear-gradient(180deg, #8fae42 0%, #6b831f 100%)",
    borderTopLeftRadius: "45% 26%",
    borderTopRightRadius: "45% 20%",
  },
  tunnel: {
    position: "absolute",
    left: "53%",
    bottom: "11%",
    width: 240,
    height: 152,
    background: "linear-gradient(180deg, #314227 0%, #091109 100%)",
    borderTopLeftRadius: 220,
    borderTopRightRadius: 220,
    borderBottomLeftRadius: 36,
    borderBottomRightRadius: 36,
    boxShadow: "inset 0 0 0 20px rgba(255,255,255,0.08)",
  },
  road: {
    position: "absolute",
    left: "-4%",
    right: "-4%",
    bottom: "24%",
    height: 26,
    borderTop: "4px solid rgba(90,79,47,0.55)",
    rotate: "-2deg",
  },
  centerPortal: {
    position: "absolute",
    left: "45%",
    top: "42%",
    width: 198,
    height: 198,
    marginLeft: -99,
    marginTop: -99,
    borderRadius: "50%",
    border: "8px solid #ffffff",
    boxShadow: "0 10px 40px rgba(0,0,0,0.15)",
    overflow: "hidden",
    background: "#8fc2ed",
  },
  centerPortalInner: {
    position: "absolute",
    inset: 0,
    background: "linear-gradient(180deg, #4f86d9 0%, #8ec1f2 55%, #bada8a 56%, #87b24b 100%)",
  },
  portalField: {
    position: "absolute",
    left: "12%",
    right: "12%",
    bottom: 0,
    height: "44%",
    background:
      "repeating-linear-gradient(90deg, rgba(74,114,44,0.82) 0 3px, rgba(150,194,112,0.75) 3px 13px)",
    clipPath: "polygon(12% 0%, 88% 0%, 100% 100%, 0% 100%)",
  },
  portalHouse: {
    position: "absolute",
    width: 18,
    height: 14,
    left: "50%",
    top: "45%",
    marginLeft: -9,
    background: "#f6f2ee",
    borderRadius: 2,
    boxShadow: "0 0 0 2px rgba(255,255,255,0.6)",
  },
  attraction: {
    position: "absolute",
    zIndex: 3,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    textDecoration: "none",
  },
  attractionInteractive: {
    cursor: "pointer",
    transition: "transform 180ms ease, filter 180ms ease",
    filter: "drop-shadow(0 16px 24px rgba(0,0,0,0.16))",
  },
  attractionStatic: {
    pointerEvents: "none",
    filter: "drop-shadow(0 12px 18px rgba(0,0,0,0.14))",
  },
  attractionLabel: {
    position: "absolute",
    left: "50%",
    top: "calc(100% + 12px)",
    transform: "translateX(-50%)",
    display: "grid",
    gap: 2,
    minWidth: 180,
    textAlign: "center",
    color: "#092008",
    fontSize: 12,
    textShadow: "0 1px 0 rgba(255,255,255,0.45)",
  },
  objectCard: {
    width: "100%",
    height: "100%",
    borderRadius: 26,
    background: "#fffdf7",
    border: "7px solid #ffffff",
    boxShadow: "0 10px 30px rgba(0,0,0,0.18)",
    position: "relative",
    overflow: "hidden",
  },
  calculatorShell: {
    background: "linear-gradient(180deg, #f8d6de 0%, #e4bdc7 100%)",
    padding: 18,
  },
  calculatorScreen: {
    position: "absolute",
    left: 18,
    right: 18,
    top: 20,
    height: 42,
    borderRadius: 10,
    background: "#e7f1e3",
    color: "#51654e",
    fontFamily: '"Courier New", monospace',
    fontSize: 18,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    letterSpacing: 1.4,
  },
  calculatorKeys: {
    position: "absolute",
    left: 18,
    right: 18,
    top: 78,
    bottom: 18,
    display: "grid",
    gridTemplateColumns: "repeat(4, 1fr)",
    gap: 8,
  },
  calculatorKey: {
    borderRadius: 10,
    background: "rgba(255,255,255,0.55)",
    border: "1px solid rgba(136,97,110,0.18)",
  },
  yarnSpool: {
    borderRadius: "40% 40% 44% 44%",
    background: "linear-gradient(180deg, #ff7d76 0%, #d7372b 100%)",
  },
  yarnCore: {
    position: "absolute",
    inset: "16% 14%",
    borderRadius: "50% 50% 44% 44%",
    background:
      "radial-gradient(circle at 50% 32%, rgba(255,255,255,0.8) 0%, rgba(255,255,255,0.15) 24%, transparent 34%), repeating-linear-gradient(180deg, rgba(255,255,255,0.28) 0 6px, rgba(255,255,255,0.03) 6px 12px)",
  },
  bookStack: {
    padding: 12,
    display: "flex",
    flexDirection: "column",
    gap: 4,
    background: "transparent",
    border: "none",
    boxShadow: "none",
  },
  book: {
    display: "block",
    height: 18,
    borderRadius: 6,
    border: "4px solid #fff",
    boxShadow: "0 4px 8px rgba(0,0,0,0.12)",
  },
  beerMug: {
    background: "linear-gradient(180deg, #fff3dc 0%, #f0cb8f 18%, #aa6e14 100%)",
  },
  beerFoam: {
    position: "absolute",
    top: 10,
    left: 12,
    right: 12,
    height: 28,
    borderRadius: 999,
    background: "#fff7ea",
  },
  beerHandle: {
    position: "absolute",
    right: 10,
    top: 50,
    width: 28,
    height: 52,
    border: "8px solid rgba(255,255,255,0.9)",
    borderLeft: "none",
    borderRadius: "0 20px 20px 0",
  },
  flowerClusterLeft: {
    position: "absolute",
    left: 40,
    bottom: "18%",
    color: "#ffe35d",
    fontSize: 72,
    rotate: "-12deg",
    textShadow: "0 6px 0 rgba(0,0,0,0.08)",
  },
  flowerClusterRight: {
    position: "absolute",
    right: 30,
    bottom: "8%",
    color: "#dff4f9",
    fontSize: 60,
    rotate: "8deg",
    textShadow: "0 6px 0 rgba(0,0,0,0.08)",
  },
  flower: { display: "inline-block" },
  introPanel: {
    position: "relative",
    zIndex: 4,
    margin: "0 36px 32px",
    width: "min(640px, calc(100% - 72px))",
    padding: "22px 24px",
    borderRadius: 26,
    background: "rgba(251, 249, 238, 0.78)",
    boxShadow: "0 24px 50px rgba(0,0,0,0.12)",
    backdropFilter: "blur(12px)",
  },
  introEyebrow: {
    fontSize: 12,
    letterSpacing: "0.24em",
    textTransform: "uppercase",
    color: "#4e6252",
    fontWeight: 700,
    marginBottom: 12,
  },
  introTitle: {
    margin: 0,
    fontSize: "clamp(1.7rem, 3vw, 2.8rem)",
    lineHeight: 1.08,
    color: "#111111",
  },
  introText: {
    margin: "12px 0 0",
    fontSize: 15,
    lineHeight: 1.7,
    color: "#304438",
    maxWidth: 560,
  },
  introActions: {
    marginTop: 18,
    display: "flex",
    flexWrap: "wrap",
    gap: 12,
    alignItems: "center",
  },
  primaryLink: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    minHeight: 46,
    padding: "0 18px",
    borderRadius: 999,
    background: "#0f170f",
    color: "#ffffff",
    textDecoration: "none",
    fontWeight: 700,
    boxShadow: "0 10px 24px rgba(0,0,0,0.16)",
  },
  secondaryHint: {
    fontSize: 13,
    color: "#4e6252",
  },
};
