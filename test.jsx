import { useState } from “react”;

const TRENDS = [
{
id: 1,
category: “🐕 Chiens & Animaux Viraux”,
color: “#f59e0b”,
bgColor: “rgba(245,158,11,0.08)”,
borderColor: “rgba(245,158,11,0.3)”,
description: “Les animaux avec une histoire = communauté instantanée”,
formula: “[Nom de l’animal] + photo virale = identité forte”,
examples: [
{ name: “$PEANUT”, detail: “Écureuil tué par le gouvernement US → indignation virale → 60M+ MC”, trigger: “Mort injuste d’un animal célèbre”, volume: “🔥🔥🔥” },
{ name: “$PUNCHE”, detail: “Chat boxeur viral sur Twitter → clip court = fuel parfait”, trigger: “Clip animal drôle ou touchant”, volume: “🔥🔥” },
{ name: “$DOGWIFHAT”, detail: “Chien avec bonnet en photo = concept ultra simple”, trigger: “Photo d’animal absurde mais attachante”, volume: “🔥🔥🔥” },
{ name: “$MICHI”, detail: “Chat Solana → simple, mignon, brand cohérent”, trigger: “Animal + univers crypto = combo gagnant”, volume: “🔥🔥” },
],
signals: [“Animal fait les news”, “Clip viral Reddit/Twitter/TikTok”, “Animal avec une ‘injustice’ = rage + dons”],
tips: “Plus l’histoire est emotionnelle (injustice, mort, sauvetage), plus le volume explose. Un animal ‘neutre’ fait moins que un animal avec un récit.”,
},
{
id: 2,
category: “🇺🇸 Politique & Figures Publiques”,
color: “#ef4444”,
bgColor: “rgba(239,68,68,0.08)”,
borderColor: “rgba(239,68,68,0.3)”,
description: “Les politiques divisent = deux camps = double volume”,
formula: “[Nom/Surnom] + moment précis (discours, scandale, tweet)”,
examples: [
{ name: “$TRUMP”, detail: “L’original. Toujours relaunchable à chaque événement Trump”, trigger: “Élection, tweet, arrestation, victoire”, volume: “🔥🔥🔥” },
{ name: “$MAGA”, detail: “Idéologie > personne. La communauté existe déjà.”, trigger: “Tout événement politique US”, volume: “🔥🔥🔥” },
{ name: “$JAVIER”, detail: “Milei en Argentine → bull run crypto argentin”, trigger: “Politicien pro-crypto étranger”, volume: “🔥🔥” },
{ name: “$EPSTEIN”, detail: “Scandale + liste → curiosité morbide = volume rapide”, trigger: “Scandale politico-judiciaire relancé”, volume: “🔥🔥” },
],
signals: [“Élection dans un pays majeur”, “Scandale politique trending”, “Discours viral / mème politique”],
tips: “Ne pas lancer trop tôt avant un événement ni trop tard après. Le sweet spot : dans les 2h du pic de trending Twitter/X.”,
},
{
id: 3,
category: “🌐 Ajouter ‘SOL’ à N’importe Quoi”,
color: “#9945ff”,
bgColor: “rgba(153,69,255,0.08)”,
borderColor: “rgba(153,69,255,0.3)”,
description: “La formule Solana : prendre un mème existant + badge SOL”,
formula: “[Mème connu] + ‘SOL’ ou couleurs violet/vert Solana”,
examples: [
{ name: “$SOLCAT”, detail: “Chat + Solana = identité chain forte, communauté SOL de base”, trigger: “Tout animal populaire pas encore ‘sol-isé’”, volume: “🔥🔥” },
{ name: “$SOLANACHAD”, detail: “Chad mème + couleurs Solana = fierté de l’écosystème”, trigger: “Moments de pump Solana”, volume: “🔥🔥” },
{ name: “$SOLPEPÉ”, detail: “Pépé recoloré en violet → reconnaissable + nouveau”, trigger: “Tout mème classique non encore sur SOL”, volume: “🔥🔥🔥” },
{ name: “$WSOL”, detail: “Wrapped + identité → play sur l’éco Solana elle-même”, trigger: “Nouveau produit ou protocole Solana”, volume: “🔥” },
],
signals: [“Solana fait un ATH ou bull run”, “Nouveau record de TPS Solana”, “Mème populaire pas encore décliné sur SOL”],
tips: “Les couleurs comptent vraiment. Violet (#9945FF) et vert (#14F195) dans le logo = signal immédiat ‘c’est un SOL token’. La communauté achète son identité.”,
},
{
id: 4,
category: “⛽ Événements Économiques Simples”,
color: “#14f195”,
bgColor: “rgba(20,241,149,0.08)”,
borderColor: “rgba(20,241,149,0.3)”,
description: “La douleur économique quotidienne = identification massive”,
formula: “[Problème que tout le monde ressent] → token simple et direct”,
examples: [
{ name: “$BARREL”, detail: “Prix essence explose → tout le monde comprend → achat émotionnel”, trigger: “Prix du pétrole dans les news”, volume: “🔥🔥🔥” },
{ name: “$EGG”, detail: “Inflation US sur les œufs 2024 → mème TikTok → token”, trigger: “Prix alimentaire trending aux infos”, volume: “🔥🔥🔥” },
{ name: “$RECESSION”, detail: “Peur économique = volume de panique”, trigger: “Chiffres macro mauvais, licenciements massifs”, volume: “🔥🔥” },
{ name: “$RENT”, detail: “Loyers qui explosent → génération Z s’identifie = early adopters”, trigger: “Crise immobilière dans les news”, volume: “🔥🔥” },
],
signals: [“Prix d’un bien de consommation dans les trends Twitter”, “Inflation headline news”, “Grève, pénurie, rupture de stock”],
tips: “Plus le problème est universel et concret (pas abstrait), plus l’identification est rapide. $BARREL > $INFLATION parce que tout le monde voit le prix à la pompe.”,
},
{
id: 5,
category: “🎭 Mèmes Internet Intemporels”,
color: “#06b6d4”,
bgColor: “rgba(6,182,212,0.08)”,
borderColor: “rgba(6,182,212,0.3)”,
description: “Les classiques ne meurent pas, ils se relancent”,
formula: “[Mème classique] + twist actuel OU simple tokenisation”,
examples: [
{ name: “$PEPE”, detail: “La grenouille originale. Toujours top 20 des volumes PumpFun”, trigger: “Toujours actif, surtout en bull run”, volume: “🔥🔥🔥” },
{ name: “$WOJAK”, detail: “Le visage de la douleur crypto = identité forte de la communauté”, trigger: “Crash de marché, bad news macro”, volume: “🔥🔥🔥” },
{ name: “$CHAD”, detail: “Contre-mème au Wojak → lancé quand les bulls dominent”, trigger: “Bull run, ATH Bitcoin”, volume: “🔥🔥” },
{ name: “$BOBO”, detail: “L’ours bearish → volume en période de correction”, trigger: “Marché bear ou correction brutale”, volume: “🔥🔥” },
],
signals: [“Mème utilisé massivement dans les CT (Crypto Twitter)”, “Pic de recherche Google d’un mème classique”, “Nouveau format viral du mème classique”],
tips: “Le timing par rapport au sentiment de marché est crucial. Wojak/Bobo performent en bear. Chad/Pepe en bull. Lancer le bon mème dans le bon cycle = multiplicateur x3 sur le volume.”,
},
{
id: 6,
category: “🎬 Pop Culture & Viral Moment”,
color: “#f97316”,
bgColor: “rgba(249,115,22,0.08)”,
borderColor: “rgba(249,115,22,0.3)”,
description: “Surfer sur une vague pop culture au bon moment”,
formula: “[Film/Série/Événement trending] + lancement dans les 24h”,
examples: [
{ name: “$HAWK”, detail: “Danse Hawk Tuah → viral TikTok → token avant même la fille”, trigger: “Clip TikTok 50M+ vues en 48h”, volume: “🔥🔥🔥” },
{ name: “$GME”, detail: “GameStop retour 2024 → Roaring Kitty revient → token”, trigger: “Personnalité ou événement WallStreetBets”, volume: “🔥🔥🔥” },
{ name: “$GHIBLI”, detail: “Trend artistique Ghibli IA → token esthétique dans les 48h”, trigger: “Trend artistique ou culturel IA viral”, volume: “🔥🔥” },
{ name: “$OSCAR”, detail: “Gifle Will Smith → tokenisé le soir même → pic 24h”, trigger: “Événement live TV mondial choquant”, volume: “🔥🔥” },
],
signals: [“TikTok/Reels > 10M vues en moins de 48h”, “Hashtag #1 trending Twitter mondial”, “Événement live inattendu (awards, sport, politique)”],
tips: “La fenêtre est courte : 2 à 6 heures après le peak du trend. Après 24h c’est souvent trop tard. Préparation clé : avoir le wallet prêt, le nom réservé, le logo simple stocké.”,
},
{
id: 7,
category: “🤖 IA & Tech Trends”,
color: “#8b5cf6”,
bgColor: “rgba(139,92,246,0.08)”,
borderColor: “rgba(139,92,246,0.3)”,
description: “Chaque annonce tech majeure = window de 48h max”,
formula: “[Produit IA / Modèle] + mème associé = identité tech-degen”,
examples: [
{ name: “$GROK”, detail: “Annonce Grok par Musk → communauté X déjà là → lancement express”, trigger: “Nouveau modèle IA annoncé par big tech”, volume: “🔥🔥🔥” },
{ name: “$GPT5”, detail: “Annonce GPT-5 → chaque sortie OpenAI → token window”, trigger: “Release majeure OpenAI/Anthropic/Google”, volume: “🔥🔥” },
{ name: “$SORA”, detail: “Modèle vidéo OpenAI → démo virale → token 48h”, trigger: “Démo produit IA qui impressionne Twitter”, volume: “🔥🔥” },
{ name: “$DEVIN”, detail: “Premier dev IA → débat massif → token d’opinion”, trigger: “Produit IA qui divise l’opinion tech”, volume: “🔥🔥” },
],
signals: [“Annonce produit IA trending > 100K tweets”, “Démo virale IA sur Twitter/X”, “Débat ‘L’IA va tuer mon job’ dans les medias”],
tips: “La communauté crypto suit l’actu IA de très près. Même une annonce technique peut faire volume si elle est accompagnée d’un visuel fort ou d’un débat émotionnel.”,
},
{
id: 8,
category: “🏆 Sport & Athlètes Viraux”,
color: “#10b981”,
bgColor: “rgba(16,185,129,0.08)”,
borderColor: “rgba(16,185,129,0.3)”,
description: “Les moments sportifs génèrent des pics d’attention mondiaux”,
formula: “[Athlète/Équipe/Moment] + événement précis = urgence d’achat”,
examples: [
{ name: “$MBAPPE”, detail: “Transfert Real Madrid → mondial trending → token FR/ES”, trigger: “Transfert record ou rumeur explosive”, volume: “🔥🔥” },
{ name: “$FURY”, detail: “Combat de boxe annoncé → communauté paris sportifs = overlap degen”, trigger: “Gros combat boxe/MMA annoncé”, volume: “🔥🔥🔥” },
{ name: “$CAITLIN”, detail: “Caitlin Clark WNBA phénomène → audience record → token”, trigger: “Athlète féminine qui casse les codes”, volume: “🔥🔥” },
{ name: “$SUPERBOWL”, detail: “Token annuel → Super Bowl = crypto audience record”, trigger: “Événement sportif mondial annuel”, volume: “🔥🔥🔥” },
],
signals: [“Finale mondiale d’un sport majeur”, “Record battu en direct”, “Athlète impliqué dans un scandale ou virage inattendu”],
tips: “Boxer/MMA > Football pour le volume memecoin. La communauté paris sportifs + degen = overlap parfait. Lancer 48h avant l’événement pour capter le pre-hype.”,
},
];

const PUMPFUN_TIPS = [
{ icon: “⏱️”, title: “Timing = Tout”, text: “2-6h après le peak de trending. Après 24h, c’est trop tard. Monitore Twitter/X Trending en continu.” },
{ icon: “📊”, title: “Volume > MC”, text: “Pour les creator fees PumpFun, 500K$ de volume à 300K MC vaut mieux que 2M MC avec peu de trading.” },
{ icon: “🎨”, title: “Logo Simple = Partage”, text: “Le logo doit être reconnaissable en 20x20px. Simple, contrasté, mémorable. Évite les détails fins.” },
{ icon: “💬”, title: “Narratif d’abord”, text: “Le nom + la description en 3 mots. Si tu peux pas expliquer le token en moins de 5 secondes, simplifie.” },
{ icon: “🔄”, title: “Relance possible”, text: “Les mèmes classiques (Pepe, Wojak, animaux) peuvent être relancés si le timing de marché change. Ce n’est pas ‘déjà fait’ = raté.” },
{ icon: “📱”, title: “TikTok > Twitter pour Vitesse”, text: “Un clip TikTok > 5M vues génère plus de volume rapide qu’un trending Twitter long. Vitesse de diffusion = volume memecoin.” },
];

export default function MemecoinDatabase() {
const [activeCategory, setActiveCategory] = useState(null);
const [search, setSearch] = useState(””);

const filtered = TRENDS.filter(t =>
t.category.toLowerCase().includes(search.toLowerCase()) ||
t.examples.some(e => e.name.toLowerCase().includes(search.toLowerCase())) ||
t.description.toLowerCase().includes(search.toLowerCase())
);

return (
<div style={{
minHeight: “100vh”,
background: “#0a0a0f”,
color: “#e2e8f0”,
fontFamily: “‘DM Mono’, ‘Courier New’, monospace”,
padding: “0”,
}}>
<style>{`
@import url(‘https://fonts.googleapis.com/css2?family=DM+Mono:wght@300;400;500&family=Syne:wght@700;800&display=swap’);

```
    * { box-sizing: border-box; }

    .header-glow {
      background: linear-gradient(135deg, #9945ff 0%, #14f195 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
    }

    .card {
      border-radius: 12px;
      transition: all 0.2s ease;
      cursor: pointer;
    }
    .card:hover {
      transform: translateY(-2px);
    }

    .example-pill {
      background: rgba(255,255,255,0.04);
      border: 1px solid rgba(255,255,255,0.08);
      border-radius: 8px;
      padding: 10px 14px;
      font-size: 13px;
      transition: all 0.2s;
    }
    .example-pill:hover {
      background: rgba(255,255,255,0.07);
    }

    .signal-tag {
      display: inline-block;
      background: rgba(255,255,255,0.05);
      border: 1px solid rgba(255,255,255,0.1);
      border-radius: 6px;
      padding: 3px 10px;
      font-size: 11px;
      margin: 3px;
      color: #94a3b8;
    }

    .tip-card {
      background: rgba(153,69,255,0.06);
      border: 1px solid rgba(153,69,255,0.2);
      border-radius: 10px;
      padding: 14px 16px;
    }

    .search-input {
      background: rgba(255,255,255,0.04);
      border: 1px solid rgba(255,255,255,0.1);
      border-radius: 10px;
      padding: 10px 16px;
      color: #e2e8f0;
      font-family: inherit;
      font-size: 14px;
      width: 100%;
      outline: none;
      transition: border-color 0.2s;
    }
    .search-input:focus {
      border-color: rgba(153,69,255,0.5);
    }
    .search-input::placeholder { color: #475569; }

    .volume-badge {
      font-size: 16px;
      letter-spacing: 2px;
    }

    ::-webkit-scrollbar { width: 6px; }
    ::-webkit-scrollbar-track { background: transparent; }
    ::-webkit-scrollbar-thumb { background: #333; border-radius: 3px; }
  `}</style>

  {/* Header */}
  <div style={{
    background: "linear-gradient(180deg, rgba(153,69,255,0.12) 0%, transparent 100%)",
    borderBottom: "1px solid rgba(153,69,255,0.2)",
    padding: "40px 32px 32px",
    textAlign: "center",
  }}>
    <div style={{ fontSize: 12, color: "#9945ff", letterSpacing: 4, marginBottom: 12, textTransform: "uppercase" }}>
      PumpFun Creator Fees Intelligence
    </div>
    <h1 className="header-glow" style={{ fontFamily: "'Syne', sans-serif", fontSize: "clamp(28px, 5vw, 52px)", fontWeight: 800, margin: "0 0 12px", lineHeight: 1.1 }}>
      MEMECOIN TREND DATABASE
    </h1>
    <p style={{ color: "#64748b", fontSize: 14, maxWidth: 480, margin: "0 auto 24px" }}>
      Patterns validés → 500K–2M$ MC · Focus volume pour creator fees
    </p>

    {/* Stats bar */}
    <div style={{ display: "flex", justifyContent: "center", gap: 32, marginBottom: 24, flexWrap: "wrap" }}>
      {[
        { label: "Catégories", value: "8" },
        { label: "Patterns validés", value: "32+" },
        { label: "MC cible", value: "500K–2M$" },
        { label: "Stratégie", value: "Volume > Prix" },
      ].map(s => (
        <div key={s.label} style={{ textAlign: "center" }}>
          <div style={{ color: "#14f195", fontFamily: "'Syne', sans-serif", fontSize: 22, fontWeight: 700 }}>{s.value}</div>
          <div style={{ color: "#475569", fontSize: 11, textTransform: "uppercase", letterSpacing: 2 }}>{s.label}</div>
        </div>
      ))}
    </div>

    <input
      className="search-input"
      placeholder="🔍  Rechercher un token, catégorie ou trigger..."
      value={search}
      onChange={e => setSearch(e.target.value)}
      style={{ maxWidth: 500 }}
    />
  </div>

  <div style={{ maxWidth: 1100, margin: "0 auto", padding: "32px 20px" }}>

    {/* Trend Cards */}
    <div style={{ display: "grid", gap: 20 }}>
      {filtered.map(trend => (
        <div
          key={trend.id}
          className="card"
          style={{
            background: trend.bgColor,
            border: `1px solid ${trend.borderColor}`,
            borderLeft: `3px solid ${trend.color}`,
            padding: "24px",
            borderRadius: 12,
          }}
          onClick={() => setActiveCategory(activeCategory === trend.id ? null : trend.id)}
        >
          {/* Category Header */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12, flexWrap: "wrap", gap: 8 }}>
            <div>
              <h2 style={{ fontFamily: "'Syne', sans-serif", fontSize: 20, fontWeight: 700, margin: "0 0 4px", color: "#f1f5f9" }}>
                {trend.category}
              </h2>
              <p style={{ color: "#94a3b8", fontSize: 13, margin: 0 }}>{trend.description}</p>
            </div>
            <span style={{
              background: `${trend.color}20`,
              border: `1px solid ${trend.color}40`,
              color: trend.color,
              borderRadius: 6,
              padding: "4px 10px",
              fontSize: 11,
              fontWeight: 500,
              whiteSpace: "nowrap",
            }}>
              {activeCategory === trend.id ? "▲ Réduire" : "▼ Détails"}
            </span>
          </div>

          {/* Formula */}
          <div style={{
            background: "rgba(0,0,0,0.3)",
            border: "1px solid rgba(255,255,255,0.06)",
            borderRadius: 8,
            padding: "8px 14px",
            marginBottom: 16,
            fontSize: 12,
            color: "#64748b",
          }}>
            <span style={{ color: trend.color, fontWeight: 500 }}>FORMULE </span>
            {trend.formula}
          </div>

          {/* Examples Grid */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 10, marginBottom: activeCategory === trend.id ? 20 : 0 }}>
            {trend.examples.map(ex => (
              <div key={ex.name} className="example-pill">
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 5 }}>
                  <span style={{ color: trend.color, fontWeight: 500, fontSize: 14 }}>{ex.name}</span>
                  <span className="volume-badge" title="Volume estimé">{ex.volume}</span>
                </div>
                <div style={{ color: "#64748b", fontSize: 11, lineHeight: 1.5 }}>{ex.detail}</div>
                <div style={{ marginTop: 6, fontSize: 10, color: "#475569" }}>
                  <span style={{ color: "#334155" }}>TRIGGER: </span>{ex.trigger}
                </div>
              </div>
            ))}
          </div>

          {/* Expanded Content */}
          {activeCategory === trend.id && (
            <div style={{ marginTop: 4, paddingTop: 20, borderTop: "1px solid rgba(255,255,255,0.06)" }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, flexWrap: "wrap" }}>
                <div>
                  <div style={{ fontSize: 11, color: "#475569", textTransform: "uppercase", letterSpacing: 2, marginBottom: 10 }}>📡 Signaux à surveiller</div>
                  {trend.signals.map(s => (
                    <span key={s} className="signal-tag" style={{ display: "block", marginBottom: 6 }}>→ {s}</span>
                  ))}
                </div>
                <div>
                  <div style={{ fontSize: 11, color: "#475569", textTransform: "uppercase", letterSpacing: 2, marginBottom: 10 }}>💡 Pro Tip</div>
                  <div style={{
                    background: "rgba(0,0,0,0.3)",
                    border: `1px solid ${trend.color}30`,
                    borderRadius: 8,
                    padding: "12px 14px",
                    fontSize: 13,
                    color: "#94a3b8",
                    lineHeight: 1.7,
                  }}>
                    {trend.tips}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      ))}
    </div>

    {/* PumpFun Tips Section */}
    <div style={{ marginTop: 40 }}>
      <div style={{ textAlign: "center", marginBottom: 24 }}>
        <div style={{ fontSize: 11, color: "#9945ff", letterSpacing: 4, textTransform: "uppercase", marginBottom: 8 }}>PumpFun Creator Fees</div>
        <h2 style={{ fontFamily: "'Syne', sans-serif", fontSize: 24, fontWeight: 700, margin: 0, color: "#f1f5f9" }}>
          Maximiser le Volume (pas le MC)
        </h2>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 14 }}>
        {PUMPFUN_TIPS.map(tip => (
          <div key={tip.title} className="tip-card">
            <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
              <span style={{ fontSize: 22, flexShrink: 0 }}>{tip.icon}</span>
              <div>
                <div style={{ color: "#14f195", fontWeight: 500, fontSize: 14, marginBottom: 4 }}>{tip.title}</div>
                <div style={{ color: "#64748b", fontSize: 12, lineHeight: 1.6 }}>{tip.text}</div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>

    {/* Volume Legend */}
    <div style={{
      marginTop: 32,
      padding: "16px 24px",
      background: "rgba(255,255,255,0.02)",
      border: "1px solid rgba(255,255,255,0.06)",
      borderRadius: 10,
      display: "flex",
      gap: 24,
      justifyContent: "center",
      flexWrap: "wrap",
      fontSize: 12,
      color: "#475569",
    }}>
      <span>🔥 Volume modéré (100K–300K$)</span>
      <span>🔥🔥 Bon volume (300K–800K$)</span>
      <span>🔥🔥🔥 Fort volume (800K–2M$+)</span>
      <span style={{ color: "#334155" }}>|</span>
      <span style={{ color: "#334155" }}>Estimation basée sur les créations PumpFun 2023-2025</span>
    </div>

  </div>
</div>
```

);
}
