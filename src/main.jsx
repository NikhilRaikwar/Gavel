import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { ethers } from "ethers";
import "@rainbow-me/rainbowkit/styles.css";
import { ConnectButton, RainbowKitProvider, getDefaultConfig } from "@rainbow-me/rainbowkit";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WagmiProvider, createConfig, http, useAccount, useChainId, useSwitchChain, useWalletClient } from "wagmi";
import { injected } from "wagmi/connectors";
import { defineChain } from "viem";
import { DISPUTE_ESCROW_ABI } from "./abi/disputeEscrowAbi";
import "./styles.css";
import { Analytics } from "@vercel/analytics/react";

const SOMNIA_CHAIN_ID = 50312;
const SOMNIA_RPC_URL = "https://api.infra.testnet.somnia.network";
const RECEIPTS_URL = "https://receipts.testnet.agents.somnia.host";
const CONTRACT_ADDRESS = import.meta.env.VITE_DISPUTE_ESCROW_ADDRESS || "";
const SITE_URL = import.meta.env.VITE_SITE_URL || "https://gavel.example.com";
const SUPPORTED_PAGES = new Set(["overview", "cases", "create", "evidence", "arbitration", "verdict", "receipt"]);

function getInitialUiState() {
  if (typeof window === "undefined") {
    return { view: "landing", page: "overview" };
  }

  const params = new URLSearchParams(window.location.search);
  const view = params.get("view") === "app" ? "app" : "landing";
  const page = SUPPORTED_PAGES.has(params.get("page")) ? params.get("page") : "overview";

  return { view, page };
}

function getSeoContent(view, page, activeDispute) {
  if (view === "landing") {
    return {
      title: "Gavel - Onchain AI Court on Somnia",
      description:
        "Gavel is a Somnia-powered onchain dispute resolution app that uses validator-executed AI agents to parse evidence, decide verdicts, and release escrow.",
      keywords:
        "Gavel, Somnia, onchain AI, dispute resolution, escrow, smart contract arbitration, LLM Parse Website, LLM Inference, Somnia agents, blockchain court"
    };
  }

  const disputeLabel = activeDispute?.latestRequestId ? `Case #${activeDispute.latestRequestId}` : "Live case";

  const pageMap = {
    overview: {
      title: "Gavel Dashboard - Onchain AI Court",
      description: "Monitor active disputes, agent performance, and onchain verdict activity in the Gavel dashboard."
    },
    cases: {
      title: "Gavel Cases - Onchain Dispute List",
      description: "Browse live and historical disputes resolved through Somnia-powered onchain arbitration."
    },
    create: {
      title: "Create a Gavel Dispute",
      description: "Open a new onchain dispute, lock escrow, and prepare evidence for Somnia agent review."
    },
    evidence: {
      title: "Submit Evidence - Gavel",
      description: "Submit plaintiff and defendant evidence URLs before requesting Somnia agent arbitration."
    },
    arbitration: {
      title: `Live Hearing - ${disputeLabel} | Gavel`,
      description: "Follow the live Somnia agent hearing as evidence is parsed and a verdict is prepared."
    },
    verdict: {
      title: `Verdict - ${disputeLabel} | Gavel`,
      description: "Review the final onchain verdict, confidence level, and payout outcome for the dispute."
    },
    receipt: {
      title: `Audit Receipt - ${disputeLabel} | Gavel`,
      description: "Inspect the Somnia execution receipt and review the validator-backed audit trail."
    }
  };

  return {
    title: pageMap[page]?.title || "Gavel - Onchain AI Court on Somnia",
    description:
      pageMap[page]?.description ||
      "Gavel is a Somnia-powered onchain dispute resolution app with validator-executed AI agents and audit receipts.",
    keywords:
      "Gavel, Somnia, dispute resolution, escrow, onchain AI, smart contract, receipt, arbitration, LLM Parse Website, LLM Inference"
  };
}

function disputeStateLabel(state) {
  return [
    "Open",
    "Evidence pending",
    "Evidence ready",
    "Arbitrating",
    "Appeal window",
    "Resolved",
    "Escalated to DAO",
    "Expired",
    "Agent failed"
  ][Number(state)] || "Unknown";
}

function isPartyInDispute(dispute, wallet) {
  if (!dispute || !wallet) return false;
  const target = wallet.toLowerCase();
  return dispute.plaintiff?.toLowerCase?.() === target || dispute.defendant?.toLowerCase?.() === target;
}

function normalizeDispute(dispute, id, wallet) {
  if (!dispute) return null;
  const lowerWallet = wallet?.toLowerCase?.() || "";
  const role =
    dispute.plaintiff?.toLowerCase?.() === lowerWallet
      ? "Plaintiff"
      : dispute.defendant?.toLowerCase?.() === lowerWallet
        ? "Defendant"
        : "Observer";

  const latestRequestId = dispute.latestRequestId?.toString?.() || "";
  const winner = dispute.winner && dispute.winner !== ethers.ZeroAddress ? dispute.winner : "";

  return {
    id: id.toString(),
    description: dispute.description || "",
    plaintiff: dispute.plaintiff,
    defendant: dispute.defendant,
    plaintiffDeposit: dispute.plaintiffDeposit?.toString?.() || "0",
    defendantDeposit: dispute.defendantDeposit?.toString?.() || "0",
    heldAmount: dispute.heldAmount?.toString?.() || "0",
    agentBudget: dispute.agentBudget?.toString?.() || "0",
    appealDeadline: dispute.appealDeadline?.toString?.() || "0",
    createdAt: dispute.createdAt?.toString?.() || "0",
    state: dispute.state,
    stateLabel: disputeStateLabel(dispute.state),
    winner,
    confidence: Number(dispute.confidence || 0),
    plaintiffEvidenceUrl: dispute.plaintiffEvidenceUrl || "",
    defendantEvidenceUrl: dispute.defendantEvidenceUrl || "",
    plaintiffSummary: dispute.plaintiffSummary || "",
    defendantSummary: dispute.defendantSummary || "",
    verdictJson: dispute.verdictJson || "",
    verdictReasoning: dispute.verdictReasoning || "",
    latestRequestId,
    role
  };
}

function caseActionForDispute(dispute) {
  if (!dispute) return { label: "View case", page: "overview" };
  if (dispute.latestRequestId) {
    if (Number(dispute.state) >= 5) return { label: "View receipt", page: "receipt" };
    if (Number(dispute.state) >= 3) return { label: "Open hearing", page: "arbitration" };
    return { label: "View verdict", page: "verdict" };
  }
  if (Number(dispute.state) <= 1) return { label: "Add evidence", page: "evidence" };
  return { label: "Continue case", page: "evidence" };
}

function setMetaContent(selector, attribute, value) {
  let element = document.head.querySelector(selector);
  if (!element) {
    element = document.createElement("meta");
    const match = selector.match(/meta\[(name|property)="([^"]+)"\]/);
    if (match) {
      element.setAttribute(match[1], match[2]);
    }
    document.head.appendChild(element);
  }
  element.setAttribute(attribute, value);
}

const somniaTestnet = defineChain({
  id: SOMNIA_CHAIN_ID,
  name: "Somnia Testnet",
  nativeCurrency: { name: "STT", symbol: "STT", decimals: 18 },
  rpcUrls: {
    default: { http: [SOMNIA_RPC_URL] }
  },
  blockExplorers: {
    default: { name: "Somnia Shannon Explorer", url: "https://shannon-explorer.somnia.network" }
  },
  testnet: true
});

const walletConnectProjectId = import.meta.env.VITE_WALLETCONNECT_PROJECT_ID;
const rainbowConfig = walletConnectProjectId
  ? getDefaultConfig({
      appName: "Gavel",
      projectId: walletConnectProjectId,
      chains: [somniaTestnet],
      ssr: false
    })
  : createConfig({
      chains: [somniaTestnet],
      connectors: [
        injected({
          target: "metaMask"
        })
      ],
      transports: {
        [somniaTestnet.id]: http(SOMNIA_RPC_URL)
      }
    });

const queryClient = new QueryClient();

function Root() {
  return (
    <WagmiProvider config={rainbowConfig}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider>
          <App />
          <Analytics />
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}

function App() {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const { switchChainAsync } = useSwitchChain();
  const { data: walletClient } = useWalletClient();
  const initialUi = getInitialUiState();
  const [view, setView] = useState(initialUi.view);
  const [page, setPage] = useState(initialUi.page);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [disputeId, setDisputeId] = useState("");
  const [activeDispute, setActiveDispute] = useState(null);
  const [caseList, setCaseList] = useState([]);
  const [caseEvents, setCaseEvents] = useState({});
  const [loadingCases, setLoadingCases] = useState(false);
  const [receipt, setReceipt] = useState(null);
  const previousAddressRef = useRef("");

  const readContract = useMemo(() => {
    if (!CONTRACT_ADDRESS) return null;
    return new ethers.Contract(CONTRACT_ADDRESS, DISPUTE_ESCROW_ABI, new ethers.JsonRpcProvider(SOMNIA_RPC_URL));
  }, []);

  const writeContract = useMemo(() => {
    if (!CONTRACT_ADDRESS || !walletClient) return null;
    const provider = new ethers.BrowserProvider(walletClient.transport);
    return provider.getSigner().then((signer) => new ethers.Contract(CONTRACT_ADDRESS, DISPUTE_ESCROW_ABI, signer));
  }, [walletClient]);

  useEffect(() => {
    const canEnterDashboard = isConnected && chainId === SOMNIA_CHAIN_ID;

    if (!canEnterDashboard) {
      setView("landing");
      setPage("overview");
      setNotice("");
      setBusy(false);
      setDisputeId("");
      setActiveDispute(null);
      setCaseList([]);
      setCaseEvents({});
      setLoadingCases(false);
      setReceipt(null);
      return;
    }

    setView("app");
  }, [isConnected, chainId]);

  useEffect(() => {
    if (!isConnected || chainId !== SOMNIA_CHAIN_ID) return;
    if (previousAddressRef.current && previousAddressRef.current !== address) {
      setCaseList([]);
      setCaseEvents({});
      setActiveDispute(null);
      setDisputeId("");
      setReceipt(null);
    }
    previousAddressRef.current = address || "";
  }, [address, isConnected, chainId]);

  useEffect(() => {
    if (!isConnected || chainId !== SOMNIA_CHAIN_ID || !readContract || !address) return;
    loadMyCases(disputeId);
  }, [address, isConnected, chainId, readContract]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const onPopState = () => {
      const next = getInitialUiState();
      setView(next.view);
      setPage(next.page);
    };

    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  useEffect(() => {
    if (typeof document === "undefined") return;

    const seo = getSeoContent(view, page, activeDispute);
    document.title = seo.title;
    setMetaContent('meta[name="description"]', "content", seo.description);
    setMetaContent('meta[name="keywords"]', "content", seo.keywords);
    setMetaContent('meta[property="og:title"]', "content", seo.title);
    setMetaContent('meta[property="og:description"]', "content", seo.description);
    setMetaContent('meta[name="twitter:title"]', "content", seo.title);
    setMetaContent('meta[name="twitter:description"]', "content", seo.description);

    const canonical = document.head.querySelector('link[rel="canonical"]');
    if (canonical) canonical.setAttribute("href", `${SITE_URL}/${view === "landing" ? "" : `?view=app&page=${page}`}`);
  }, [view, page, activeDispute]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const params = new URLSearchParams();
    if (view === "app") {
      params.set("view", "app");
      params.set("page", page);
    }

    const nextUrl = `${window.location.pathname}${params.toString() ? `?${params.toString()}` : ""}${window.location.hash}`;
    if (`${window.location.pathname}${window.location.search}${window.location.hash}` !== nextUrl) {
      window.history.replaceState({}, "", nextUrl);
    }
  }, [view, page]);

  useEffect(() => {
    if (!readContract) return undefined;

    const onRequest = (id, requestId, stage) => {
      const key = id.toString();
      setCaseEvents((current) => ({
        ...current,
        [key]: [
          ...(current[key] || []),
          {
            agent: stageName(Number(stage)).toUpperCase(),
            step: `Somnia request #${requestId.toString()} created`,
            data: "Waiting for validator consensus and callback.",
            time: new Date().toLocaleTimeString(),
            requestId: requestId.toString(),
            status: "active"
          }
        ]
      }));
    };
    const onStep = (id, stage, step, data) => {
      const key = id.toString();
      setCaseEvents((current) => ({
        ...current,
        [key]: [
          ...(current[key] || []),
          {
            agent: stageName(Number(stage)).toUpperCase(),
            step,
            data,
            time: new Date().toLocaleTimeString(),
            status: "done"
          }
        ]
      }));
    };
    const onVerdict = (id, winner, confidence, reasoning, verdictJson) => {
      const key = id.toString();
      setCaseEvents((current) => ({
        ...current,
        [key]: [
          ...(current[key] || []),
          {
            agent: "JUDGE",
            step: `Verdict delivered to ${shortAddress(winner)}`,
            data: `${confidence}% confidence - ${reasoning || verdictJson}`,
            time: new Date().toLocaleTimeString(),
            status: "done"
          }
        ]
      }));
      loadDispute(id.toString());
    };

    readContract.on("AgentRequestCreated", onRequest);
    readContract.on("AgentStep", onStep);
    readContract.on("VerdictDelivered", onVerdict);
    return () => {
      readContract.off("AgentRequestCreated", onRequest);
      readContract.off("AgentStep", onStep);
      readContract.off("VerdictDelivered", onVerdict);
    };
  }, [readContract]);

  async function ensureSomnia() {
    if (!isConnected) {
      setNotice("Connect a wallet with RainbowKit first.");
      return false;
    }
    if (chainId !== SOMNIA_CHAIN_ID) {
      await switchChainAsync({ chainId: SOMNIA_CHAIN_ID });
    }
    return true;
  }

  async function getWriteContract() {
    if (!(await ensureSomnia())) return null;
    if (!CONTRACT_ADDRESS) {
      setNotice("Set VITE_DISPUTE_ESCROW_ADDRESS after deploying the contract.");
      return null;
    }
    return writeContract;
  }

  async function loadMyCases(preferredId = "") {
    if (!readContract || !address) return [];
    setLoadingCases(true);
    try {
      const total = Number(await readContract.disputeCount());
      const disputes = await Promise.all(
        Array.from({ length: total }, async (_, index) => {
          const dispute = await readContract.getDispute(index);
          return isPartyInDispute(dispute, address) ? normalizeDispute(dispute, index, address) : null;
        })
      );
      const owned = disputes.filter(Boolean).sort((a, b) => Number(b.id) - Number(a.id));
      setCaseList(owned);

      const nextId = preferredId || disputeId || owned[0]?.id || "";
      if (nextId && owned.some((entry) => entry.id === nextId)) {
        await loadDispute(nextId, owned);
      } else if (owned[0]) {
        await loadDispute(owned[0].id, owned);
      } else {
        setDisputeId("");
        setActiveDispute(null);
        setReceipt(null);
        setCaseEvents({});
      }

      return owned;
    } catch (error) {
      setNotice(error.shortMessage || error.message);
      return [];
    } finally {
      setLoadingCases(false);
    }
  }

  async function loadSelectedCase(id) {
    const target = id?.toString?.() || "";
    if (!target) return;
    if (caseList.length > 0 && !caseList.some((entry) => entry.id === target)) {
      setNotice("That case is not associated with your connected wallet.");
      return;
    }
    await loadDispute(target);
  }

  async function createDispute(event) {
    event.preventDefault();
    const contractPromise = await getWriteContract();
    if (!contractPromise) return;
    const contract = await contractPromise;
    const form = new FormData(event.currentTarget);
    setBusy(true);
    try {
      const tx = await contract.createDispute(
        form.get("defendant"),
        form.get("description"),
        { value: ethers.parseEther(form.get("stake") || "0") }
      );
      const txReceipt = await tx.wait();
      const parsed = txReceipt.logs
        .map((log) => safeParse(contract, log))
        .find((log) => log?.name === "DisputeCreated");
      const nextId = parsed?.args?.id?.toString() || "";
      setDisputeId(nextId);
      setNotice(`Case #${nextId} created. Defendant can now join with matching stake.`);
      setPage("evidence");
      setView("app");
      if (nextId) await loadMyCases(nextId);
    } catch (error) {
      setNotice(error.shortMessage || error.message);
    } finally {
      setBusy(false);
    }
  }

  async function submitEvidence(side) {
    const contractPromise = await getWriteContract();
    if (!contractPromise || !disputeId) {
      setNotice("Load or create a dispute first.");
      return;
    }
    const input = document.querySelector(`[data-evidence="${side}"]`);
    if (!input?.value) {
      setNotice("Evidence URL is required.");
      return;
    }
    setBusy(true);
    try {
      const contract = await contractPromise;
      const tx = await contract.submitEvidence(disputeId, input.value);
      await tx.wait();
      setNotice("Evidence submitted on-chain.");
      await loadMyCases(disputeId);
    } catch (error) {
      setNotice(error.shortMessage || error.message);
    } finally {
      setBusy(false);
    }
  }

  async function requestArbitration() {
    const contractPromise = await getWriteContract();
    if (!contractPromise || !disputeId) {
      setNotice("Load or create a dispute first.");
      return;
    }
    const budget = document.querySelector("[data-agent-budget]")?.value || "0.90";
    setBusy(true);
    try {
      const contract = await contractPromise;
      const tx = await contract.requestArbitration(disputeId, { value: ethers.parseEther(budget) });
      await tx.wait();
      setNotice("Somnia agent pipeline started.");
      setPage("arbitration");
      await loadMyCases(disputeId);
    } catch (error) {
      setNotice(error.shortMessage || error.message);
    } finally {
      setBusy(false);
    }
  }

  async function loadDispute(id = disputeId, ownedCases = caseList) {
    if (!readContract || id === "") {
      setNotice("Set a deployed contract address and dispute ID first.");
      return;
    }
    try {
      const dispute = await readContract.getDispute(id);
      const normalized = normalizeDispute(dispute, id, address);
      if (address && !isPartyInDispute(dispute, address)) {
        setActiveDispute(null);
        setReceipt(null);
        setNotice("This case is not part of the connected wallet.");
        return;
      }
      if (ownedCases.length > 0 && !ownedCases.some((entry) => entry.id === normalized.id)) {
        setActiveDispute(null);
        setReceipt(null);
        setNotice("This case is not part of the connected wallet.");
        return;
      }
      setActiveDispute(normalized);
      setDisputeId(normalized.id);
      setReceipt(null);
    } catch (error) {
      setNotice(error.shortMessage || error.message);
    }
  }

  async function loadReceipt(requestId) {
    const target = requestId || activeDispute?.latestRequestId?.toString?.();
    if (!target) {
      setNotice("This case has not started arbitration yet, so no Somnia request ID exists.");
      return;
    }
    try {
      const response = await fetch(`${RECEIPTS_URL}?requestId=${target}`);
      if (!response.ok) throw new Error(`Receipt service returned ${response.status}`);
      setReceipt(await response.json());
      setPage("receipt");
    } catch (error) {
      setNotice(`Receipt unavailable: ${error.message}`);
    }
  }

  async function shareVerdict() {
    if (!activeDispute?.verdictJson) {
      setNotice("No verdict is available to share for this case yet.");
      return;
    }

    const shareText = [
      `Gavel verdict for case #${disputeId}`,
      `Winner: ${activeDispute.winner || "pending"}`,
      `Confidence: ${activeDispute.confidence || 0}%`,
      `Reasoning: ${activeDispute.verdictReasoning || "pending"}`,
      `Receipt request ID: ${activeDispute.latestRequestId || "pending"}`
    ].join("\n");

    try {
      if (navigator.share) {
        await navigator.share({
          title: `Gavel verdict for case #${disputeId}`,
          text: shareText
        });
      } else {
        await navigator.clipboard.writeText(shareText);
        setNotice("Verdict copied to clipboard.");
      }
    } catch (error) {
      setNotice(error.message || "Unable to share verdict.");
    }
  }

  if (view === "landing") {
    return <Landing onOpenApp={() => setView("app")} />;
  }

  const selectedCaseEvents = disputeId ? caseEvents[disputeId] || [] : [];

  return (
    <DashboardShell
      page={page}
      setPage={setPage}
      notice={notice}
      busy={busy}
      loadingCases={loadingCases}
      address={address}
      chainId={chainId}
      caseList={caseList}
      activeDispute={activeDispute}
      disputeId={disputeId}
      setDisputeId={setDisputeId}
      events={selectedCaseEvents}
      receipt={receipt}
      createDispute={createDispute}
      loadDispute={loadDispute}
      loadMyCases={loadMyCases}
      loadSelectedCase={loadSelectedCase}
      submitEvidence={submitEvidence}
      requestArbitration={requestArbitration}
      loadReceipt={loadReceipt}
      shareVerdict={shareVerdict}
    />
  );
}

function Landing({ onOpenApp }) {
  return (
    <div className="landing-page">
      <nav className="landing-nav">
        <button className="nav-logo" type="button">
          <img src="/favicon.svg" alt="Gavel Logo" className="logo-img" />
          Gavel
        </button>
        <ul className="nav-links">
          <li><a href="#how">How it works</a></li>
          <li><a href="#agents">Agents</a></li>
          <li><a href="#usecases">Use cases</a></li>
          <li>
            <ConnectButton.Custom>
              {({ account, chain, mounted, openChainModal, openConnectModal }) => {
                const ready = mounted;
                const connected = ready && account && chain;
                if (!connected) return <button className="nav-cta" onClick={openConnectModal}>Connect wallet</button>;
                if (chain.unsupported || chain.id !== SOMNIA_CHAIN_ID) return <button className="nav-cta" onClick={openChainModal}>Switch to Somnia</button>;
                return <button className="nav-cta" onClick={onOpenApp}>Enter dashboard</button>;
              }}
            </ConnectButton.Custom>
          </li>
        </ul>
      </nav>

      <section className="hero-wrap">
        <div className="hero">
          <div className="hero-eyebrow"><span className="dot" />Live on Somnia Testnet</div>
          <h1>The onchain<br /><em>AI court.</em></h1>
          <p className="hero-sub">Two parties. One dispute. A jury of AI agents reads the evidence, deliberates on-chain, and enforces a binding verdict - automatically.</p>
          <div className="hero-actions">
            <ConnectButton.Custom>
              {({ account, chain, mounted, openChainModal, openConnectModal }) => {
                const ready = mounted;
                const connected = ready && account && chain;
                if (!connected) return <button className="btn-primary" onClick={openConnectModal}>Connect wallet <span>→</span></button>;
                if (chain.unsupported || chain.id !== SOMNIA_CHAIN_ID) return <button className="btn-primary" onClick={openChainModal}>Switch to Somnia <span>→</span></button>;
                return <button className="btn-primary" onClick={onOpenApp}>Enter dashboard <span>→</span></button>;
              }}
            </ConnectButton.Custom>
            <a href="#how" className="btn-secondary">See how it works <span>⌄</span></a>
          </div>
          <div className="hero-stats">
            <div className="stat-item"><span className="stat-num">1</span><span className="stat-label">Escrow contract</span></div>
            <div className="stat-item"><span className="stat-num">3</span><span className="stat-label">Live Somnia agents</span></div>
            <div className="stat-item"><span className="stat-num">100%</span><span className="stat-label">On-chain receipts</span></div>
          </div>
          <div className="hero-visual">
            <div className="verdict-card">
              <div className="vc-header">
                <div className="vc-gavel">⚖</div>
                <div><div className="vc-title">Live dispute pipeline</div><div className="vc-id">Connect your wallet to load your cases</div></div>
              </div>
              <div className="vc-steps">
                <VerdictStep name="Research Agent" sub="Extracts factual claims from public evidence" done />
                <VerdictStep name="Validator Agent" sub="Checks claims for consistency" done />
                <VerdictStep name="Judge Agent" sub="Returns the final verdict JSON" active />
              </div>
              <div className="vc-verdict">
                <div className="vc-verdict-label">Verdict</div>
                <div className="vc-verdict-winner">No case selected</div>
                <div className="vc-verdict-reason">Connect a wallet, open one of your disputes, and the live verdict and receipt panels will populate from Somnia.</div>
                <div className="vc-verdict-conf"><div className="conf-bar"><div className="conf-fill" /></div><span className="conf-label">Awaiting request</span></div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <div className="built-on">
        <span className="built-on-label">Built on</span>
        <div className="somnia-badge"><span className="somnia-dot" /> Somnia Agentic L1</div>
        <span className="built-on-label">Powered by deterministic on-chain AI</span>
      </div>

      <section id="how" className="section">
        <div className="section-label">How it works</div>
        <h2 className="section-title">From dispute to<br />verdict in four steps</h2>
        <p className="section-sub">No lawyers. No oracles. No off-chain servers. Just smart contracts and AI agents.</p>
        <div className="steps-grid">
          <StepCard num="01" icon="🔒" title="Lock escrow" text="Both parties deposit equal stakes into the Gavel smart contract. Funds are locked until verdict." />
          <StepCard num="02" icon="📎" title="Submit evidence" text="Each party submits URLs or JSON as evidence - GitHub commits, invoices, screenshots, any public link." />
          <StepCard num="03" icon="🤖" title="Agents deliberate" text="Somnia AI agents autonomously read and reason over all evidence." />
          <StepCard num="04" icon="⚖" title="Verdict enforced" text="The binding verdict triggers automatic fund release. Every step is receipted and auditable." />
        </div>
      </section>

      <section id="agents" className="agents-section">
        <div className="agents-inner">
          <div className="section-label">The AI jury</div>
          <h2 className="section-title">Four agents.<br />One verdict.</h2>
          <p className="section-sub">Gavel chains Somnia AI agents that debate, cross-check, and reach consensus - just like a real jury.</p>
          <div className="agents-grid">
            {["Research Agent", "Validator Agent", "Skeptic Agent", "Judge Agent"].map((name, index) => (
              <div className="agent-card" key={name}>
                <div className="agent-badge">AGENT 0{index + 1}</div>
                <h3>{name}</h3>
                <p>{agentCopy(name)}</p>
              </div>
            ))}
          </div>
          <div className="deterministic-box">
            <div>
              <div className="mini-label">Powered by</div>
              <div>Somnia deterministic LLMs - fixed seeds, consensus-verified outputs</div>
            </div>
            <div className="mono muted">Same input → same output → consensus → truth</div>
          </div>
        </div>
      </section>

      <section id="usecases" className="section">
        <div className="section-label">Use cases</div>
        <h2 className="section-title">Built for the<br />trustless economy</h2>
        <p className="section-sub">Anywhere value changes hands, Gavel can arbitrate.</p>
        <div className="usecases-grid">
          <UseCase icon="💼" title="Freelance work" text="Developers, designers, writers - lock payment in escrow and let Gavel verify deliverables against the brief." tag="Most common use case" />
          <UseCase icon="🛒" title="P2P marketplace" text="Goods, NFTs, digital assets. Buyer and seller both protected." tag="Zero platform liability" />
          <UseCase icon="🏛" title="DAO grants & bounties" text="Release grant funds only when deliverables are verified." tag="Trustless governance" />
          <UseCase icon="📋" title="B2B milestones" text="Enterprise contracts with milestone-based payments." tag="No escrow agent needed" />
          <UseCase icon="🎯" title="Prediction markets" text="Agents parse official sources to determine outcomes." tag="Fully autonomous resolution" />
          <UseCase icon="🔐" title="Insurance claims" text="Parametric insurance triggered by real-world events." tag="Instant autonomous payout" />
        </div>
      </section>

      <div className="cta-banner">
        <h2>Ready to open your case?</h2>
        <p>No registration. No legal fees. Just your wallet and your evidence.</p>
        <ConnectButton.Custom>
          {({ account, chain, mounted, openChainModal, openConnectModal }) => {
            const ready = mounted;
            const connected = ready && account && chain;
            if (!connected) return <button className="btn-white" onClick={openConnectModal}>Connect wallet →</button>;
            if (chain.unsupported || chain.id !== SOMNIA_CHAIN_ID) return <button className="btn-white" onClick={openChainModal}>Switch to Somnia →</button>;
            return <button className="btn-white" onClick={onOpenApp}>Enter dashboard →</button>;
          }}
        </ConnectButton.Custom>
      </div>
      <footer><div className="footer-inner"><div className="footer-logo">Gavel</div><ul className="footer-links"><li>GitHub</li><li>Docs</li><li>Somnia</li></ul><div className="footer-copy">Built for Somnia Agentathon 2026</div></div></footer>
    </div>
  );
}

function DashboardShell(props) {
  const { page, setPage, notice, address, chainId, activeDispute, disputeId, caseList, loadingCases } = props;
  const pageTitle =
    page === "overview"
      ? "Dashboard"
      : page === "cases"
        ? "My Cases"
        : page === "create"
          ? "New Case"
          : page === "evidence"
            ? activeDispute ? `Evidence - Case #${disputeId}` : "Submit Evidence"
            : page === "arbitration"
              ? activeDispute ? `Live Hearing - Case #${disputeId}` : "Live Hearing"
              : page === "verdict"
                ? activeDispute ? `Verdict - Case #${disputeId}` : "Verdict"
                : activeDispute ? `Audit Receipt - Case #${disputeId}` : "Audit Receipt";
  return (
    <div className="dashboard-body">
      <div className="sidebar-overlay" />
      <aside className="sidebar" id="sidebar">
        <div className="sidebar-logo">
          <div className="logo-text">
            <img src="/favicon.svg" alt="Gavel Logo" className="logo-img" />
            Gavel
          </div>
        </div>
        <nav className="sidebar-nav">
          <div className="nav-section-label">Overview</div>
          <NavItem active={page === "overview"} icon="⊞" label="Dashboard" onClick={() => setPage("overview")} />
          <NavItem active={page === "cases"} icon="📋" label="My Cases" onClick={() => setPage("cases")} />
          <div className="nav-section-label">Actions</div>
          <NavItem active={page === "create"} icon="＋" label="New Case" onClick={() => setPage("create")} />
          <NavItem active={page === "evidence"} icon="📎" label="Submit Evidence" onClick={() => setPage("evidence")} />
          <NavItem active={page === "arbitration"} icon="🤖" label="Live Hearing" onClick={() => setPage("arbitration")} />
          <div className="nav-section-label">Results</div>
          <NavItem active={page === "verdict"} icon="⚖" label="Verdict" onClick={() => setPage("verdict")} />
          <NavItem active={page === "receipt"} icon="🔍" label="Audit Receipt" onClick={() => setPage("receipt")} />
        </nav>
        <div className="sidebar-footer">
          <div className="wallet-pill"><div className={chainId === SOMNIA_CHAIN_ID ? "wallet-dot" : "wallet-dot warn"} /><span className="wallet-addr">{address ? shortAddress(address) : "Not connected"}</span></div>
          <div className="sidebar-network">Somnia Testnet · 50312</div>
        </div>
      </aside>

      <main className="main">
        <div className="topbar">
          <div className="topbar-title">{pageTitle}</div>
          <div className="topbar-actions">
            <ConnectButton.Custom>
              {({ account, chain, openAccountModal, openChainModal, openConnectModal, mounted }) => {
                const ready = mounted;
                const connected = ready && account && chain;
                if (!connected) return <button className="btn btn-dark" onClick={openConnectModal}>Connect wallet</button>;
                if (chain.unsupported || chain.id !== SOMNIA_CHAIN_ID) return <button className="btn btn-outline" onClick={openChainModal}>Switch to Somnia</button>;
                return <button className="btn btn-outline" onClick={openAccountModal}>{account.displayName}</button>;
              }}
            </ConnectButton.Custom>
            <button className="btn btn-dark" onClick={() => setPage("create")}>+ New Case</button>
          </div>
        </div>

        {notice && <div className="app-notice">{notice}</div>}
        {!CONTRACT_ADDRESS && <div className="app-notice warn">Set VITE_DISPUTE_ESCROW_ADDRESS after deploy.</div>}

        {page === "overview" && <Overview setPage={setPage} caseList={caseList} loadingCases={loadingCases} loadSelectedCase={props.loadSelectedCase} loadReceipt={props.loadReceipt} />}
        {page === "cases" && <Cases setPage={setPage} caseList={caseList} loadingCases={loadingCases} loadSelectedCase={props.loadSelectedCase} loadReceipt={props.loadReceipt} />}
        {page === "create" && <Create {...props} />}
        {page === "evidence" && <Evidence {...props} />}
        {page === "arbitration" && <LiveHearing {...props} />}
        {page === "verdict" && <Verdict {...props} />}
        {page === "receipt" && <Receipt {...props} />}
      </main>
    </div>
  );
}

function Overview({ setPage, caseList, loadingCases, loadSelectedCase, loadReceipt }) {
  const totalCases = caseList.length;
  const activeCases = caseList.filter((entry) => Number(entry.state) >= 0 && Number(entry.state) <= 3).length;
  const resolvedCases = caseList.filter((entry) => Number(entry.state) >= 5).length;
  const lockedStake = caseList.reduce((sum, entry) => sum + Number(entry.plaintiffDeposit || 0) + Number(entry.defendantDeposit || 0), 0);
  return (
    <div className="page active">
      <div className="stats-row">
        <StatCard label="Total cases" value={String(totalCases)} sub={loadingCases ? "Loading on-chain cases..." : "Connected wallet cases"} positive />
        <StatCard label="Active disputes" value={String(activeCases)} sub="Awaiting evidence or arbitration" amber />
        <StatCard label="Funds in escrow" value={lockedStake ? lockedStake.toFixed(2) : "0.00"} sub="STT locked" />
        <StatCard label="Verdicts issued" value={String(resolvedCases)} sub="On-chain outcomes" positive />
      </div>
      <div className="card">
        <div className="card-header"><div><div className="card-title">Recent cases</div><div className="card-subtitle">Your disputes and arbitrations</div></div><button className="btn btn-outline" onClick={() => setPage("cases")}>View all</button></div>
        <CaseTable setPage={setPage} caseList={caseList} loadSelectedCase={loadSelectedCase} loadReceipt={loadReceipt} compact />
      </div>
      <div className="overview-grid">
        <div className="card metric-card">
          <div className="card-title">Agent performance</div>
          {["Research Agent", "Judge Agent"].map((agent, index) => <ProgressRow key={agent} label={agent} value={[98, 100][index]} />)}
        </div>
        <div className="card metric-card">
          <div className="card-title">Verdict distribution</div>
          <Distribution color="var(--green)" label="Resolved cases" value={`${resolvedCases} case(s)`} />
          <Distribution color="var(--accent)" label="In progress" value={`${activeCases} case(s)`} />
          <Distribution color="var(--ink-muted)" label="Wallet visible" value={`${totalCases} case(s)`} />
          <div className="metric-footer">Filtered to the connected wallet only.</div>
        </div>
      </div>
    </div>
  );
}

function Cases({ setPage, caseList, loadingCases, loadSelectedCase, loadReceipt }) {
  return (
    <div className="page active">
      <div className="filters">
        <input placeholder="Search your cases..." />
        <select>
          <option>All statuses</option>
          <option>Resolved</option>
          <option>Arbitrating</option>
          <option>Evidence pending</option>
        </select>
        <button className="btn btn-accent" onClick={() => setPage("create")}>+ New case</button>
      </div>
      <div className="card">
        <div className="card-header">
          <div>
            <div className="card-title">Your on-chain disputes</div>
            <div className="card-subtitle">{loadingCases ? "Loading disputes from Somnia..." : "Only disputes where your connected wallet is plaintiff or defendant appear here."}</div>
          </div>
        </div>
        <CaseTable setPage={setPage} caseList={caseList} loadSelectedCase={loadSelectedCase} loadReceipt={loadReceipt} />
      </div>
    </div>
  );
}

function Create({ createDispute, busy }) {
  return (
    <div className="page active">
      <div className="step-indicator">
        <StepInd active label="Case details" num="1" /><div className="step-line" /><StepInd label="Lock escrow" num="2" /><div className="step-line" /><StepInd label="Evidence" num="3" /><div className="step-line" /><StepInd label="Verdict" num="4" />
      </div>
      <form className="card" onSubmit={createDispute}>
        <div className="card-header"><div><div className="card-title">New dispute</div><div className="card-subtitle">Both parties will stake equal amounts. Loser forfeits.</div></div></div>
        <div className="card-pad">
          <div className="form-grid">
            <div className="form-group full"><label>Dispute description</label><textarea name="description" required placeholder="Briefly describe the nature of the dispute..." /><div className="form-hint">Be factual and concise. The AI agents will read this.</div></div>
            <div className="form-group"><label>Defendant wallet address</label><input name="defendant" required placeholder="0x..." /><div className="form-hint">The opposing party's Somnia wallet</div></div>
            <div className="form-group"><label>Your stake amount</label><div className="stake-input-wrap"><input name="stake" type="number" required min="0.01" step="0.01" defaultValue="1" /><span className="stake-suffix">STT</span></div><div className="form-hint">Defendant must match this amount to join</div></div>
          </div>
          <div className="form-section-title">Your evidence (optional - add now or later)</div>
          <div className="form-grid">
            <div className="form-group"><label>Evidence URL 1</label><input type="url" placeholder="https://github.com/..." /></div>
            <div className="form-group"><label>Evidence URL 2</label><input type="url" placeholder="https://..." /></div>
            <div className="form-group full"><label>Additional context (optional)</label><textarea placeholder="Any JSON data, transaction hashes, or extra notes..." /></div>
          </div>
          <div className="escrow-note"><strong>How escrow works</strong><span>Your stake is locked in the Gavel smart contract. After agents reach a verdict, funds auto-release to the winner. Unused gas is rebated.</span></div>
          <div className="form-actions"><button className="btn btn-outline" type="button">Cancel</button><button className="btn btn-dark" disabled={busy}>{busy ? "Creating..." : "Create case & lock stake →"}</button></div>
        </div>
      </form>
    </div>
  );
}

function Evidence({ disputeId, setDisputeId, activeDispute, caseList, loadSelectedCase, submitEvidence, requestArbitration, busy, loadingCases }) {
  const currentCase = activeDispute || caseList.find((entry) => entry.id === disputeId) || null;
  const canArbitrate = currentCase && currentCase.plaintiffEvidenceUrl && currentCase.defendantEvidenceUrl;

  return (
    <div className="page active">
      <div className="case-loader">
        <select value={disputeId} onChange={(event) => loadSelectedCase(event.target.value)}>
          <option value="">Select your case</option>
          {caseList.map((entry) => (
            <option value={entry.id} key={entry.id}>Case #{entry.id} · {entry.stateLabel}</option>
          ))}
        </select>
        <button className="btn btn-outline" onClick={() => loadSelectedCase(disputeId)} disabled={!disputeId || loadingCases}>Load</button>
        <input data-agent-budget type="number" min="0.90" step="0.01" defaultValue="0.90" />
        <span>Agent budget STT</span>
      </div>

      {!currentCase ? (
        <div className="card">
          <div className="card-pad">
            <div className="empty-state">Select one of your on-chain disputes to view evidence, hearing, verdict, and receipt.</div>
          </div>
        </div>
      ) : (
        <>
          <div className="pending-banner">Case #{currentCase.id} · {currentCase.stateLabel}</div>
          <div className="evidence-layout">
            <EvidenceParty title="Plaintiff" address={currentCase.plaintiff} url={currentCase.plaintiffEvidenceUrl} side="plaintiff" onSubmit={submitEvidence} busy={busy} />
            <EvidenceParty title="Defendant" address={currentCase.defendant} url={currentCase.defendantEvidenceUrl} side="defendant" onSubmit={submitEvidence} busy={busy} />
          </div>
          <div className="card timeline-card">
            <div className="card-header"><div className="card-title">Evidence timeline</div></div>
            <ReceiptTimeline receipt={null} />
          </div>
          <div className="right-actions">
            <button className="btn btn-dark" onClick={requestArbitration} disabled={busy || !canArbitrate}>Request arbitration →</button>
          </div>
        </>
      )}
    </div>
  );
}

function LiveHearing({ events, activeDispute, disputeId, loadReceipt }) {
  const hasRequest = Boolean(activeDispute?.latestRequestId);
  return (
    <div className="page active">
      <div className="hearing-banner">
        <div className="feed-status-dot dot-amber" />
        <span>Case #{disputeId || "—"} - {hasRequest ? `Somnia request #${activeDispute.latestRequestId}` : "Waiting for arbitration to start"}</span>
        <span>{hasRequest ? "Live hearing" : "No request yet"}</span>
      </div>
      <div className="card">
        <div className="card-header"><div className="card-title">Agent reasoning feed</div><div className="card-subtitle">On-chain updates for this case only</div></div>
        <div className="card-pad">
          <div className="agent-feed">
            {events.length > 0 ? events.map((event, index) => <FeedItem key={`${event.step}-${index}`} event={event} />) : <div className="empty-state">No agent events yet for this case.</div>}
          </div>
        </div>
      </div>
      <div className="hearing-stats">
        <StatMini label="Escrow locked" value={activeDispute ? `${Number(activeDispute.plaintiffDeposit || 0) + Number(activeDispute.defendantDeposit || 0)} STT` : "0 STT"} sub="Auto-releases on verdict" />
        <StatMini label="Latest request" value={activeDispute?.latestRequestId || "—"} sub={activeDispute?.latestRequestId ? "Available on Somnia" : "No request yet"} />
        <StatMini label="Status" value={activeDispute?.stateLabel || "No case"} sub="Selected wallet case" />
      </div>
      <div className="right-actions"><button className="btn btn-outline" onClick={() => loadReceipt()} disabled={!hasRequest}>Open latest receipt</button></div>
    </div>
  );
}

function Verdict({ activeDispute, disputeId, loadReceipt, shareVerdict }) {
  const confidence = Number(activeDispute?.confidence || 0);
  const winner = activeDispute?.winner ? shortAddress(activeDispute.winner) : "Awaiting verdict";
  const reasoning = activeDispute?.verdictReasoning || "No verdict has been delivered for this case yet.";
  const verdictReady = Boolean(activeDispute?.verdictJson);
  return (
    <div className="page active">
      <div className="verdict-box">
        <div className="verdict-label">Case #{disputeId || "—"} · Final verdict</div>
        <div className="verdict-winner">⚖ {winner}</div>
        <div className="verdict-conf-row"><div className="verdict-conf-bar"><div className="verdict-conf-fill" style={{ width: `${confidence}%` }} /></div><span>{confidence}% confidence</span></div>
        <div className="verdict-reason">{verdictReady ? `"${reasoning}"` : "No verdict has been recorded for this case yet."}</div>
      </div>
      <div className="verdict-meta-row">
        <Meta label="Winner receives" value={!verdictReady ? "Waiting" : confidence >= 90 ? "Full escrow" : confidence >= 60 ? "80% now" : "DAO review"} green={verdictReady && confidence >= 90} />
        <Meta label="Verdict issued" value={verdictReady ? "On-chain" : "Pending"} />
        <Meta label="Auto-executed" value={verdictReady ? "✓ Yes" : "Pending"} green={verdictReady} />
      </div>
      <div className="card tx-card">
        <div className="card-header"><div className="card-title">Transaction confirmed</div></div>
        <div className="card-pad">
          {verdictReady ? (
            <>
              <TxRow label="Latest request ID" value={activeDispute.latestRequestId} />
              <TxRow label="State" value={activeDispute.stateLabel} />
              <TxRow label="Agent budget" value={`${Number(activeDispute.agentBudget || 0) / 1e18} STT`} />
              <TxRow label="Result" value={activeDispute.verdictJson} />
            </>
          ) : (
            <div className="empty-state">This case is still waiting for arbitration, so there is no verdict receipt to show yet.</div>
          )}
        </div>
      </div>
      <div className="form-actions">
        <button className="btn btn-dark" onClick={() => loadReceipt()} disabled={!activeDispute?.latestRequestId}>View audit receipt →</button>
        <button className="btn btn-outline" onClick={shareVerdict} disabled={!verdictReady}>Share verdict</button>
      </div>
    </div>
  );
}

function Receipt({ receipt, activeDispute, disputeId }) {
  const hasReceipt = Boolean(receipt);
  async function exportReceipt() {
    if (!receipt) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify(receipt, null, 2));
    } catch (error) {
      console.error(error);
    }
  }
  return (
    <div className="page active">
      <div className="receipt-top">
        <div>
          <div className="muted">Case</div>
          <div className="mono">#{disputeId || "—"} {activeDispute ? `- ${activeDispute.description}` : ""}</div>
        </div>
        <span className="badge badge-green"><span className="badge-dot" />{hasReceipt ? "Fetched from Somnia receipts" : "Waiting for request ID"}</span>
        <button className="btn btn-outline" onClick={exportReceipt} disabled={!hasReceipt}>Export JSON</button>
      </div>
      <div className="card">
        <div className="card-header"><div><div className="card-title">Execution receipt</div><div className="card-subtitle">{hasReceipt ? "Fetched from Somnia receipt service" : "No receipt for this case yet"}</div></div></div>
        <ReceiptTimeline receipt={receipt} />
      </div>
      <div className="receipt-note">🔏 Receipt results are auditable; callback result controls escrow.</div>
    </div>
  );
}

function CaseTable({ setPage, caseList, loadSelectedCase, loadReceipt, compact }) {
  const rows = caseList.map((entry) => {
    const action = caseActionForDispute(entry);
    return { ...entry, action };
  });

  return (
    <table>
      <thead>
        <tr>
          <th>Case ID</th>
          <th>Description</th>
          <th>Role</th>
          <th>Stake</th>
          <th>Status</th>
          <th>Action</th>
        </tr>
      </thead>
      <tbody>
        {rows.length > 0 ? rows.map((row) => (
          <tr
            key={row.id}
            onClick={() => {
              loadSelectedCase(row.id);
              if (row.action.page === "receipt" && row.latestRequestId) {
                loadReceipt(row.latestRequestId);
                return;
              }
              setPage(row.action.page);
            }}
          >
            <td className="mono">#{row.id}</td>
            <td>{row.description || "No description"}</td>
            <td><span className="badge badge-gray">{row.role}</span></td>
            <td className="mono">{(Number(row.plaintiffDeposit || 0) + Number(row.defendantDeposit || 0)).toFixed(2)} STT</td>
            <td><StatusBadge status={row.stateLabel} /></td>
            <td><span className="action-link">{row.action.label}</span></td>
          </tr>
        )) : (
          <tr><td colSpan="6"><div className="empty-state">No disputes are associated with this wallet yet.</div></td></tr>
        )}
      </tbody>
    </table>
  );
}

function ReceiptTimeline({ receipt }) {
  if (!receipt) {
    return <div className="receipt-timeline"><div className="empty-state">This case has no receipt yet. Start arbitration to generate a Somnia audit trail.</div></div>;
  }

  const steps = receipt.steps || receipt?.events || [];
  return <div className="receipt-timeline">{steps.map((step, index) => Array.isArray(step) ? <ReceiptStep key={step[0]} name={step[0]} time={step[1]} detail={step[2]} code={step[3]} /> : <ReceiptStep key={index} name={step.name} time={step.timestamp || ""} detail={step.body_preview || step.output || JSON.stringify(step)} code={JSON.stringify(step)} />)}</div>;
}

function VerdictStep({ name, sub, done, active }) {
  return <div className="vc-step"><div className={`vc-step-icon ${done ? "step-done" : ""} ${active ? "step-active" : ""}`}>{done ? "✓" : "⟳"}</div><div className="vc-step-text"><div className="vc-step-name">{name}</div><div className="vc-step-sub">{sub}</div></div></div>;
}
function StepCard({ num, icon, title, text }) { return <div className="step-card"><div className="step-num">{num}</div><div className="step-icon-box">{icon}</div><h3>{title}</h3><p>{text}</p></div>; }
function UseCase({ icon, title, text, tag }) { return <div className="usecase-card"><div className="usecase-icon">{icon}</div><h3>{title}</h3><p>{text}</p><div className="usecase-tag">→ {tag}</div></div>; }
function NavItem({ active, icon, label, onClick }) { return <button className={`nav-item ${active ? "active" : ""}`} onClick={onClick}><span className="nav-icon">{icon}</span>{label}</button>; }
function StatCard({ label, value, sub, positive, amber }) { return <div className="stat-card"><div className="stat-card-label">{label}</div><div className="stat-card-value">{value}</div><div className={`stat-card-sub ${positive ? "stat-positive" : ""}`} style={amber ? { color: "var(--amber)" } : undefined}>{sub}</div></div>; }
function ProgressRow({ label, value }) { return <div className="progress-row"><div><span>{label}</span><span className="mono">{value}% success</span></div><div><span style={{ width: `${value}%` }} /></div></div>; }
function Distribution({ color, label, value }) { return <div className="distribution"><span style={{ background: color }} /><p>{label}</p><b className="mono">{value}</b></div>; }
function StepInd({ active, label, num }) { return <div className={`step-ind ${active ? "active" : ""}`}><div className="step-ind-circle">{num}</div><span className="step-ind-label">{label}</span></div>; }
function EvidenceParty({ title, address, url, side, onSubmit, busy }) { return <div className="evidence-party"><div className="party-label">{title}</div><div className="party-addr">{typeof address === "string" ? address : shortAddress(address)}</div>{url ? <div className="evidence-item"><div className="evidence-icon">🔗</div><div><div className="evidence-url">{url}</div><div className="evidence-status">✓ Submitted · Ready for agent parse</div></div></div> : <div className="empty-small">Waiting for evidence</div>}<div className="evidence-submit"><label>Add evidence</label><input data-evidence={side} type="url" placeholder="https://..." /><button className="btn btn-dark" onClick={() => onSubmit(side)} disabled={busy}>Submit evidence URL</button></div></div>; }
function FeedItem({ event }) { return <div className="feed-item"><div className={`feed-status-dot ${event.status === "active" ? "dot-amber" : "dot-green"}`} /><div className="feed-agent-badge">{event.agent}</div><div className="feed-content"><div className="feed-step">{event.step}</div><div className="feed-detail">{event.data}</div></div><div className="feed-time">{event.time}</div></div>; }
function StatMini({ label, value, sub }) { return <div className="card mini-stat"><div>{label}</div><strong>{value}</strong><span>{sub}</span></div>; }
function Meta({ label, value, green }) { return <div className="verdict-meta-card"><div className="verdict-meta-label">{label}</div><div className="verdict-meta-value" style={green ? { color: "var(--green)" } : undefined}>{value}</div></div>; }
function TxRow({ label, value, green }) { return <div className="tx-row"><span>{label}</span><span className="mono" style={green ? { color: "var(--green)" } : undefined}>{value}</span></div>; }
function ReceiptStep({ name, time, detail, code }) { return <div className="receipt-step"><div className="receipt-step-header"><span className="receipt-step-name">{name}</span><span className="receipt-step-time">{time}</span></div><div className="receipt-step-detail">{detail}</div><div className="receipt-code">{code}</div></div>; }
function StatusBadge({ status }) { const cls = status === "Resolved" ? "badge-green" : status === "Expired" ? "badge-red" : "badge-amber"; return <span className={`badge ${cls}`}><span className="badge-dot" />{status}</span>; }

function agentCopy(name) {
  return {
    "Research Agent": "Fetches and parses all evidence URLs using Somnia's LLM Parse Website.",
    "Validator Agent": "Cross-checks claims using JSON API Request and flags inconsistencies.",
    "Skeptic Agent": "Stress-tests both sides and scores evidence quality using LLM Inference.",
    "Judge Agent": "Synthesises outputs into a final structured verdict with confidence."
  }[name];
}

function safeParse(contract, log) {
  try { return contract.interface.parseLog(log); } catch { return null; }
}
function stageName(stage) { return ["None", "Research", "Research", "Judge"][stage] || "Agent"; }
function shortAddress(value) { if (!value) return "0x..."; return `${value.slice(0, 6)}...${value.slice(-4)}`; }

createRoot(document.getElementById("root")).render(<Root />);
