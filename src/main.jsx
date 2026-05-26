import React, { useEffect, useMemo, useState } from "react";
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

const SOMNIA_CHAIN_ID = 50312;
const SOMNIA_RPC_URL = "https://api.infra.testnet.somnia.network";
const RECEIPTS_URL = "https://receipts.testnet.agents.somnia.host";
const CONTRACT_ADDRESS = import.meta.env.VITE_DISPUTE_ESCROW_ADDRESS || "";

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

const demoEvents = [
  {
    agent: "RESEARCH",
    step: "Parsed plaintiff evidence URL",
    data: "github.com/audit-co/report - Found 3 claims: audit completed, final report delivered, timestamped commit history.",
    time: "42s ago",
    status: "done",
    sample: true
  },
  {
    agent: "RESEARCH",
    step: "Parsed defendant evidence URL",
    data: "notion.so/audit-contract - Found milestone spec and missing remediation guide requirement.",
    time: "38s ago",
    status: "done",
    sample: true
  },
  {
    agent: "JUDGE",
    step: "Deliberating final verdict...",
    data: "Synthesising parsed evidence. This is demo fallback data until a live contract event arrives.",
    time: "Now",
    status: "active",
    sample: true
  }
];

function Root() {
  return (
    <WagmiProvider config={rainbowConfig}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider>
          <App />
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
  const [view, setView] = useState(() => (isConnected ? "app" : "landing"));
  const [page, setPage] = useState("overview");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [disputeId, setDisputeId] = useState("");
  const [activeDispute, setActiveDispute] = useState(null);
  const [events, setEvents] = useState(demoEvents);
  const [receipt, setReceipt] = useState(null);

  useEffect(() => {
    const canEnterDashboard = isConnected && chainId === SOMNIA_CHAIN_ID;

    if (!canEnterDashboard) {
      setView("landing");
      setPage("overview");
      setNotice("");
      setBusy(false);
      setDisputeId("");
      setActiveDispute(null);
      setEvents(demoEvents);
      setReceipt(null);
      return;
    }

    setView("app");
  }, [isConnected, chainId]);

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
    if (!readContract) return undefined;

    const onRequest = (id, requestId, stage) => {
      if (disputeId && id.toString() !== disputeId) return;
      setEvents((current) => [
        ...current.filter((item) => !item.sample),
        {
          agent: stageName(Number(stage)).toUpperCase(),
          step: `Somnia request #${requestId.toString()} created`,
          data: "Waiting for validator consensus and callback.",
          time: new Date().toLocaleTimeString(),
          requestId: requestId.toString(),
          status: "active"
        }
      ]);
    };
    const onStep = (id, stage, step, data) => {
      if (disputeId && id.toString() !== disputeId) return;
      setEvents((current) => [
        ...current.filter((item) => !item.sample),
        {
          agent: stageName(Number(stage)).toUpperCase(),
          step,
          data,
          time: new Date().toLocaleTimeString(),
          status: "done"
        }
      ]);
    };
    const onVerdict = (id, winner, confidence, reasoning, verdictJson) => {
      if (disputeId && id.toString() !== disputeId) return;
      setEvents((current) => [
        ...current.filter((item) => !item.sample),
        {
          agent: "JUDGE",
          step: `Verdict delivered to ${shortAddress(winner)}`,
          data: `${confidence}% confidence - ${reasoning || verdictJson}`,
          time: new Date().toLocaleTimeString(),
          status: "done"
        }
      ]);
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
  }, [readContract, disputeId]);

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
      if (nextId) await loadDispute(nextId);
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
      await loadDispute(disputeId);
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
      await loadDispute(disputeId);
    } catch (error) {
      setNotice(error.shortMessage || error.message);
    } finally {
      setBusy(false);
    }
  }

  async function loadDispute(id = disputeId) {
    if (!readContract || id === "") {
      setNotice("Set a deployed contract address and dispute ID first.");
      return;
    }
    try {
      const dispute = await readContract.getDispute(id);
      setActiveDispute(dispute);
      setDisputeId(id);
    } catch (error) {
      setNotice(error.shortMessage || error.message);
    }
  }

  async function loadReceipt(requestId) {
    const target = requestId || activeDispute?.latestRequestId?.toString?.();
    if (!target) {
      setNotice("No Somnia request ID available yet.");
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

  if (view === "landing") {
    return <Landing onOpenApp={() => setView("app")} />;
  }

  return (
    <DashboardShell
      page={page}
      setPage={setPage}
      notice={notice}
      busy={busy}
      address={address}
      chainId={chainId}
      activeDispute={activeDispute}
      disputeId={disputeId}
      setDisputeId={setDisputeId}
      events={events}
      receipt={receipt}
      createDispute={createDispute}
      loadDispute={loadDispute}
      submitEvidence={submitEvidence}
      requestArbitration={requestArbitration}
      loadReceipt={loadReceipt}
    />
  );
}

function Landing({ onOpenApp }) {
  return (
    <div className="landing-page">
      <nav className="landing-nav">
        <button className="nav-logo" type="button">
          <div className="gavel-icon">
            <svg viewBox="0 0 24 24"><path d="M9 3L5 7l10 10 4-4L9 3zM3 21l6-6M15 3l6 6" /></svg>
          </div>
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
            <div className="stat-item"><span className="stat-num">0</span><span className="stat-label">Human arbiters</span></div>
            <div className="stat-item"><span className="stat-num">4</span><span className="stat-label">AI agents in jury</span></div>
            <div className="stat-item"><span className="stat-num">&lt;60s</span><span className="stat-label">Avg. verdict time</span></div>
          </div>
          <div className="hero-visual">
            <div className="verdict-card">
              <div className="vc-header">
                <div className="vc-gavel">⚖</div>
                <div><div className="vc-title">CASE #0042</div><div className="vc-id">Freelance delivery dispute</div></div>
              </div>
              <div className="vc-steps">
                <VerdictStep name="Research Agent" sub="Parsed 2 evidence URLs" done />
                <VerdictStep name="Validator Agent" sub="Cross-checked 3 claims" done />
                <VerdictStep name="Skeptic Agent" sub="Found no contradictions" done />
                <VerdictStep name="Judge Agent" sub="Deliberating..." active />
              </div>
              <div className="vc-verdict">
                <div className="vc-verdict-label">Verdict</div>
                <div className="vc-verdict-winner">Plaintiff wins</div>
                <div className="vc-verdict-reason">GitHub history confirms delivery 3 days before deadline. Funds released.</div>
                <div className="vc-verdict-conf"><div className="conf-bar"><div className="conf-fill" /></div><span className="conf-label">87% confidence</span></div>
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
  const { page, setPage, notice, address, chainId } = props;
  return (
    <div className="dashboard-body">
      <div className="sidebar-overlay" />
      <aside className="sidebar" id="sidebar">
        <div className="sidebar-logo"><div className="logo-text"><span className="logo-dot" /> Gavel</div></div>
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
          <div className="topbar-title">{pageTitles[page]}</div>
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
        {!CONTRACT_ADDRESS && <div className="app-notice warn">Set VITE_DISPUTE_ESCROW_ADDRESS after deploy. Demo data is labeled where used.</div>}

        {page === "overview" && <Overview setPage={setPage} />}
        {page === "cases" && <Cases setPage={setPage} />}
        {page === "create" && <Create {...props} />}
        {page === "evidence" && <Evidence {...props} />}
        {page === "arbitration" && <LiveHearing {...props} />}
        {page === "verdict" && <Verdict {...props} />}
        {page === "receipt" && <Receipt {...props} />}
      </main>
    </div>
  );
}

function Overview({ setPage }) {
  return (
    <div className="page active">
      <div className="stats-row">
        <StatCard label="Total cases" value="12" sub="↑ 3 this week" positive />
        <StatCard label="Active disputes" value="4" sub="2 awaiting evidence" amber />
        <StatCard label="Funds in escrow" value="24.6" sub="STT locked" />
        <StatCard label="Verdicts issued" value="8" sub="100% auto-executed" positive />
      </div>
      <div className="card">
        <div className="card-header"><div><div className="card-title">Recent cases</div><div className="card-subtitle">Your disputes and arbitrations</div></div><button className="btn btn-outline" onClick={() => setPage("cases")}>View all</button></div>
        <CaseTable setPage={setPage} compact />
      </div>
      <div className="overview-grid">
        <div className="card metric-card">
          <div className="card-title">Agent performance</div>
          {["Research Agent", "Validator Agent", "Skeptic Agent", "Judge Agent"].map((agent, index) => <ProgressRow key={agent} label={agent} value={[98, 95, 97, 100][index]} />)}
        </div>
        <div className="card metric-card">
          <div className="card-title">Verdict distribution</div>
          <Distribution color="var(--green)" label="Plaintiff wins" value="5 cases (62%)" />
          <Distribution color="var(--accent)" label="Defendant wins" value="2 cases (25%)" />
          <Distribution color="var(--ink-muted)" label="Split decision" value="1 case (13%)" />
          <div className="metric-footer">Avg. confidence: <strong>84.3%</strong></div>
        </div>
      </div>
    </div>
  );
}

function Cases({ setPage }) {
  return (
    <div className="page active">
      <div className="filters"><input placeholder="Search cases..." /><select><option>All statuses</option><option>Resolved</option><option>Arbitrating</option></select><button className="btn btn-accent" onClick={() => setPage("create")}>+ New case</button></div>
      <div className="card"><CaseTable setPage={setPage} /></div>
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

function Evidence({ disputeId, setDisputeId, activeDispute, loadDispute, submitEvidence, requestArbitration, busy }) {
  return (
    <div className="page active">
      <div className="case-loader"><input value={disputeId} onChange={(event) => setDisputeId(event.target.value)} placeholder="Load dispute ID" /><button className="btn btn-outline" onClick={() => loadDispute()}>Load</button><input data-agent-budget type="number" min="0.90" step="0.01" defaultValue="0.90" /><span>Agent budget STT</span></div>
      <div className="pending-banner">⏳ Case #{disputeId || "0040"} - Waiting for both parties to submit evidence before arbitration can begin.</div>
      <div className="evidence-layout">
        <EvidenceParty title="Plaintiff (you)" address={activeDispute?.plaintiff || "0x3f4a...8b2c"} url={activeDispute?.plaintiffEvidenceUrl || "https://github.com/alex/nft-project/commit/a3f9..."} side="plaintiff" onSubmit={submitEvidence} busy={busy} />
        <EvidenceParty title="Defendant" address={activeDispute?.defendant || "0x8b1d...2e99"} url={activeDispute?.defendantEvidenceUrl || ""} side="defendant" onSubmit={submitEvidence} busy={busy} />
      </div>
      <div className="card timeline-card"><div className="card-header"><div className="card-title">Evidence timeline</div></div><ReceiptTimeline demo /></div>
      <div className="right-actions"><button className="btn btn-dark" onClick={requestArbitration} disabled={busy}>Request arbitration →</button></div>
    </div>
  );
}

function LiveHearing({ events, activeDispute, loadReceipt }) {
  return (
    <div className="page active">
      <div className="hearing-banner"><div className="feed-status-dot dot-amber" /><span>Case #{activeDispute?.latestRequestId ? "live" : "0041"} - Agents are deliberating</span><span>Est. 30s remaining</span></div>
      <div className="card">
        <div className="card-header"><div className="card-title">Agent reasoning feed</div><div className="card-subtitle">Live · Signed by validators</div></div>
        <div className="card-pad"><div className="agent-feed">{events.map((event, index) => <FeedItem key={`${event.step}-${index}`} event={event} />)}</div></div>
      </div>
      <div className="hearing-stats"><StatMini label="Escrow locked" value="10.0 STT" sub="Auto-releases on verdict" /><StatMini label="Agents complete" value={`${Math.min(events.length, 3)} / 4`} sub="Judge deliberating" /><StatMini label="Consensus nodes" value="7 / 9" sub="Majority reached" /></div>
      <div className="right-actions"><button className="btn btn-outline" onClick={() => loadReceipt()}>Open latest receipt</button></div>
    </div>
  );
}

function Verdict({ activeDispute, loadReceipt }) {
  const confidence = Number(activeDispute?.confidence || 87);
  const winner = activeDispute?.winner && activeDispute.winner !== ethers.ZeroAddress ? shortAddress(activeDispute.winner) : "Plaintiff";
  const reasoning = activeDispute?.verdictReasoning || "GitHub commit history confirms full design delivery 3 days before the agreed deadline. No evidence of incompleteness was substantiated by the defendant.";
  return (
    <div className="page active">
      <div className="verdict-box">
        <div className="verdict-label">Case #{activeDispute ? "live" : "0042"} · Final verdict</div>
        <div className="verdict-winner">⚖ {winner} wins</div>
        <div className="verdict-conf-row"><div className="verdict-conf-bar"><div className="verdict-conf-fill" style={{ width: `${confidence}%` }} /></div><span>{confidence}% confidence</span></div>
        <div className="verdict-reason">"{reasoning}"</div>
      </div>
      <div className="verdict-meta-row"><Meta label="Winner receives" value={confidence >= 90 ? "Full escrow" : confidence >= 60 ? "80% now" : "DAO review"} green /><Meta label="Verdict issued" value="48s" /><Meta label="Auto-executed" value="✓ Yes" green /></div>
      <div className="card tx-card"><div className="card-header"><div className="card-title">Transaction confirmed</div></div><div className="card-pad"><TxRow label="Tx hash" value="0xa3f9b2c8d1e4...7f22" /><TxRow label="Block" value="#4,827,441" /><TxRow label="Gas used" value="142,800" /><TxRow label="Rebate" value="+0.12 STT returned" green /></div></div>
      <div className="form-actions"><button className="btn btn-dark" onClick={() => loadReceipt()}>View audit receipt →</button><button className="btn btn-outline">Share verdict</button></div>
    </div>
  );
}

function Receipt({ receipt }) {
  return (
    <div className="page active">
      <div className="receipt-top"><div><div className="muted">Case</div><div className="mono">#0042 - Freelance logo design</div></div><span className="badge badge-green"><span className="badge-dot" />Signed by validators</span><button className="btn btn-outline">Export JSON</button></div>
      <div className="card"><div className="card-header"><div><div className="card-title">Execution receipt</div><div className="card-subtitle">{receipt ? "Fetched from Somnia receipt service" : "Demo fallback audit trail"}</div></div></div><ReceiptTimeline receipt={receipt} /></div>
      <div className="receipt-note">🔏 Receipt results are auditable; callback result controls escrow.</div>
    </div>
  );
}

function CaseTable({ setPage }) {
  const rows = [
    ["#0042", "Freelance logo design delivery", "Plaintiff", "2.0 STT", "Resolved", "View verdict", "verdict"],
    ["#0041", "Smart contract audit milestone", "Defendant", "5.0 STT", "Arbitrating", "Live hearing", "arbitration"],
    ["#0040", "NFT artwork commission", "Plaintiff", "1.5 STT", "Evidence pending", "Add evidence", "evidence"],
    ["#0039", "DAO grant delivery dispute", "Plaintiff", "10.0 STT", "Resolved", "View receipt", "receipt"]
  ];
  return (
    <table>
      <thead><tr><th>Case ID</th><th>Description</th><th>Role</th><th>Stake</th><th>Status</th><th>Action</th></tr></thead>
      <tbody>{rows.map((row) => <tr key={row[0]} onClick={() => setPage(row[6])}><td className="mono">{row[0]}</td><td>{row[1]}</td><td><span className="badge badge-gray">{row[2]}</span></td><td className="mono">{row[3]}</td><td><StatusBadge status={row[4]} /></td><td><span className="action-link">{row[5]}</span></td></tr>)}</tbody>
    </table>
  );
}

function ReceiptTimeline({ receipt }) {
  const steps = receipt?.steps || [
    ["Request received", "2026-05-27 14:02:31 UTC", "Agent pipeline triggered by contract. Deposit: 0.8 STT.", "requestId: 0xd8f2a1c9b3e744f28a..."],
    ["Research Agent - plaintiff URL", "14:02:34 UTC", "LLM Parse Website extracted factual claims from plaintiff URL.", '{"claims":["Design delivered","All revisions included"],"credibility":94}'],
    ["Research Agent - defendant URL", "14:02:37 UTC", "LLM Parse Website extracted original brief and compared deliverables.", '{"spec":"Logo + variants + source files","claims_matched":3}'],
    ["Judge Agent - final verdict", "14:02:48 UTC", "LLM Inference synthesised all outputs. Deterministic verdict issued.", '{"winner":"plaintiff","confidence":87,"reasoning":"GitHub confirms delivery."}']
  ];
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

const pageTitles = {
  overview: "Dashboard",
  cases: "My Cases",
  create: "New Case",
  evidence: "Submit Evidence",
  arbitration: "Live Hearing - Case #0041",
  verdict: "Verdict - Case #0042",
  receipt: "Audit Receipt - Case #0042"
};

createRoot(document.getElementById("root")).render(<Root />);
