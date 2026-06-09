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
const SOMNIA_RPC_URL = import.meta.env.VITE_SOMNIA_RPC_URL || "https://api.infra.testnet.somnia.network";
const RECEIPTS_URL = "https://receipts.testnet.agents.somnia.host";
const SOMNIA_AGENTS_ADDRESS = import.meta.env.VITE_SOMNIA_AGENTS_ADDRESS || "0x037Bb9C718F3f7fe5eCBDB0b600D607b52706776";
const CONTRACT_ADDRESS = import.meta.env.VITE_DISPUTE_ESCROW_ADDRESS || "0xEd614e7A3A80fd26426c6780cC15cf9a4F003f21";
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
    "Agent failed",
    "Resolved",
    "Expired",
    "Recovered"
  ][Number(state)] || "Unknown";
}

function errorMessage(error) {
  return error?.shortMessage || error?.reason || error?.info?.error?.message || error?.message || "Transaction failed.";
}

function formatStt(value, fractionDigits = 4) {
  try {
    const formatted = ethers.formatEther(value || 0);
    const numeric = Number(formatted);
    if (!Number.isFinite(numeric)) return "0";
    return numeric.toLocaleString(undefined, {
      maximumFractionDigits: fractionDigits,
      minimumFractionDigits: 0
    });
  } catch {
    return "0";
  }
}

function isPartyInDispute(dispute, wallet) {
  if (!dispute || !wallet) return false;
  const target = wallet.toLowerCase();
  return dispute.plaintiff?.toLowerCase?.() === target || dispute.defendant?.toLowerCase?.() === target;
}

function normalizeDispute(dispute, id, wallet, requestIds = []) {
  if (!dispute) return null;
  const lowerWallet = wallet?.toLowerCase?.() || "";
  const role =
    dispute.plaintiff?.toLowerCase?.() === lowerWallet
      ? "Plaintiff"
      : dispute.defendant?.toLowerCase?.() === lowerWallet
        ? "Defendant"
        : "Observer";

  const normalizedRequestIds = Array.from(requestIds || []).map((value) => value?.toString?.() || "").filter((value) => value && value !== "0");
  const latestRequestId = normalizedRequestIds.at(-1) || "";
  const winner = dispute.winner && dispute.winner !== ethers.ZeroAddress ? dispute.winner : "";

  return {
    id: id.toString(),
    description: dispute.description || "",
    plaintiff: dispute.plaintiff,
    defendant: dispute.defendant,
    plaintiffDeposit: dispute.plaintiffDeposit?.toString?.() || "0",
    defendantDeposit: dispute.defendantDeposit?.toString?.() || "0",
    arbitrationFunder: dispute.arbitrationFunder || "",
    heldAmount: "0",
    agentBudget: dispute.agentBudget?.toString?.() || "0",
    failedAt: dispute.failedAt?.toString?.() || "0",
    createdAt: dispute.createdAt?.toString?.() || "0",
    state: dispute.state,
    stateLabel: disputeStateLabel(dispute.state),
    winner,
    confidence: Number(dispute.confidence || 0),
    plaintiffEvidenceUrl: dispute.plaintiffEvidenceUrl || "",
    defendantEvidenceUrl: dispute.defendantEvidenceUrl || "",
    plaintiffSummary: dispute.plaintiffSummary || "",
    defendantSummary: dispute.defendantSummary || "",
    validationSummary: dispute.validationSummary || "",
    skepticSummary: dispute.skepticSummary || "",
    verdictJson: dispute.verdictReasoning ? `GAVEL_V1|${winner ? (winner.toLowerCase() === dispute.plaintiff?.toLowerCase?.() ? "plaintiff" : "defendant") : "split"}|${Number(dispute.confidence || 0)}|${dispute.verdictReasoning}` : "",
    verdictReasoning: dispute.verdictReasoning || "",
    latestRequestId,
    requestIds: normalizedRequestIds,
    currentStage: Number(dispute.currentStage || 0),
    failedStage: Number(dispute.failedStage || 0),
    role
  };
}

function caseActionForDispute(dispute) {
  if (!dispute) return { label: "View case", page: "overview" };
  if (dispute.latestRequestId) {
    if (Number(dispute.state) === 5) return { label: "View receipt", page: "receipt" };
    if (Number(dispute.state) === 4) return { label: "Recover case", page: "evidence" };
    if (Number(dispute.state) === 3) return { label: "Open hearing", page: "arbitration" };
    return { label: "View verdict", page: "verdict" };
  }
  if (Number(dispute.state) <= 2) return { label: "Add evidence", page: "evidence" };
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
  const [verdictTxHash, setVerdictTxHash] = useState("");
  const [createTxHash, setCreateTxHash] = useState("");
  const [arbitrationTxHash, setArbitrationTxHash] = useState("");
  const [receiptLoading, setReceiptLoading] = useState(false);
  const [receiptError, setReceiptError] = useState("");
  const [walletWithdrawable, setWalletWithdrawable] = useState(0n);
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
      setWalletWithdrawable(0n);
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
    const onStep = (id, requestId, stage, data) => {
      const key = id.toString();
      setCaseEvents((current) => ({
        ...current,
        [key]: [
          ...(current[key] || []),
          {
            agent: stageName(Number(stage)).toUpperCase(),
            step: `${stageName(Number(stage))} completed (request #${requestId.toString()})`,
            data,
            time: new Date().toLocaleTimeString(),
            status: "done"
          }
        ]
      }));
    };
    const onVerdict = (id, winner, confidence, reasoning, verdictJson, eventLog) => {
      const key = id.toString();
      const hash = eventLog?.log?.transactionHash || eventLog?.transactionHash || "";
      if (hash) {
        setVerdictTxHash(hash);
        localStorage.setItem(`gavel_verdict_tx_${key}`, hash);
      }
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
    readContract.on("AgentStepCompleted", onStep);
    readContract.on("VerdictDelivered", onVerdict);
    return () => {
      readContract.off("AgentRequestCreated", onRequest);
      readContract.off("AgentStepCompleted", onStep);
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
    if (!writeContract) {
      setNotice("Wallet signer is not ready yet. Reconnect your wallet and try again.");
      return null;
    }
    return writeContract;
  }

  async function loadMyCases(preferredId = "") {
    if (!readContract || !address) return [];
    setLoadingCases(true);
    try {
      const [ids, withdrawableAmount] = await Promise.all([
        readContract.getPartyCaseIds(address),
        readContract.withdrawable(address)
      ]);
      setWalletWithdrawable(withdrawableAmount);
      const disputes = await Promise.all(
        ids.map(async (id) => {
          const [dispute, requestIds] = await Promise.all([readContract.getDispute(id), readContract.getStageRequestIds(id)]);
          return isPartyInDispute(dispute, address) ? normalizeDispute(dispute, id, address, requestIds) : null;
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
    const formElement = event.currentTarget;
    const contractPromise = await getWriteContract();
    if (!contractPromise) return;
    const contract = await contractPromise;
    const form = new FormData(formElement);
    const defendant = String(form.get("defendant") || "").trim();
    const description = String(form.get("description") || "").trim();
    const stake = String(form.get("stake") || "").trim();

    if (!ethers.isAddress(defendant)) {
      setNotice("Enter a valid defendant wallet address.");
      return;
    }
    if (defendant.toLowerCase() === address?.toLowerCase()) {
      setNotice("Defendant wallet must be different from your connected wallet.");
      return;
    }
    if (!description) {
      setNotice("Dispute description is required.");
      return;
    }
    if (!stake || Number(stake) <= 0) {
      setNotice("Stake amount must be greater than 0 STT.");
      return;
    }

    setBusy(true);
    try {
      const tx = await contract.createDispute(
        defendant,
        description,
        { value: ethers.parseEther(stake) }
      );
      const txReceipt = await tx.wait();
      const parsed = txReceipt.logs
        .map((log) => safeParse(contract, log))
        .find((log) => log?.name === "DisputeCreated");
      const nextId = parsed?.args?.id?.toString() || "";
      setDisputeId(nextId);
      if (nextId && tx.hash) {
        localStorage.setItem(`gavel_create_tx_${nextId}`, tx.hash);
      }
      setNotice(`Case #${nextId} created. Defendant can now join with matching stake.`);
      setPage("evidence");
      setView("app");
      if (nextId) await loadMyCases(nextId);
    } catch (error) {
      setNotice(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function joinDispute() {
    const contractPromise = await getWriteContract();
    if (!contractPromise || !activeDispute) {
      setNotice("Load an open dispute first.");
      return;
    }
    if (address?.toLowerCase() !== activeDispute.defendant?.toLowerCase()) {
      setNotice("Only the defendant wallet can join this dispute.");
      return;
    }
    if (Number(activeDispute.state) !== 0) {
      setNotice("This dispute is no longer open for joining.");
      return;
    }

    setBusy(true);
    try {
      const contract = await contractPromise;
      const tx = await contract.joinDispute(activeDispute.id, { value: BigInt(activeDispute.plaintiffDeposit || "0") });
      await tx.wait();
      setNotice(`Case #${activeDispute.id} joined. Both parties can now submit evidence.`);
      await loadMyCases(activeDispute.id);
      setPage("evidence");
    } catch (error) {
      setNotice(errorMessage(error));
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
      setNotice(errorMessage(error));
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
    const minimum = await readContract.minimumAgentBudget();
    const budgetInput = document.querySelector("[data-agent-budget]")?.value;
    const budget = budgetInput ? ethers.parseEther(budgetInput) : minimum;
    if (budget < minimum) {
      setNotice(`Agent budget must be at least ${formatStt(minimum)} STT.`);
      return;
    }
    setBusy(true);
    try {
      const contract = await contractPromise;
      const tx = await contract.requestArbitration(disputeId, { value: budget });
      await tx.wait();
      if (tx.hash) {
        localStorage.setItem(`gavel_arbitration_tx_${disputeId}`, tx.hash);
      }
      setNotice("Somnia agent pipeline started.");
      setPage("arbitration");
      await loadMyCases(disputeId);
    } catch (error) {
      setNotice(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function retryFailedStage() {
    const contractPromise = await getWriteContract();
    if (!contractPromise || !activeDispute || Number(activeDispute.state) !== 4) return;
    setBusy(true);
    try {
      const required = await readContract.requiredBudget(activeDispute.failedStage);
      const contract = await contractPromise;
      const tx = await contract.retryFailedStage(disputeId, { value: required });
      await tx.wait();
      setNotice(`Failed stage retried with ${formatStt(required)} STT.`);
      await loadMyCases(disputeId);
      setPage("arbitration");
    } catch (error) {
      setNotice(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function recoverFailedDispute() {
    const contractPromise = await getWriteContract();
    if (!contractPromise || !activeDispute || Number(activeDispute.state) !== 4) return;
    setBusy(true);
    try {
      const contract = await contractPromise;
      const tx = await contract.recoverFailedDispute(disputeId);
      await tx.wait();
      setNotice("Escrow and remaining agent budget credited for withdrawal.");
      await loadMyCases(disputeId);
    } catch (error) {
      setNotice(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function withdrawFunds() {
    const contractPromise = await getWriteContract();
    if (!contractPromise) return;
    setBusy(true);
    try {
      const amount = await readContract.withdrawable(address);
      if (amount === 0n) throw new Error("No credited funds are available.");
      const contract = await contractPromise;
      const tx = await contract.withdraw();
      await tx.wait();
      setWalletWithdrawable(0n);
      setNotice(`${formatStt(amount)} STT withdrawn.`);
      await loadMyCases(disputeId);
    } catch (error) {
      setNotice(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function fetchPastEvents(id, normalized) {
    if (!readContract) return;
    const target = normalized || activeDispute;
    if (!target) return;

    const reconstructed = [];
    (target.requestIds || []).forEach((requestId, index) => {
      reconstructed.push({
        agent: stageName(index + 1).toUpperCase(),
        step: `Somnia request #${requestId} created`,
        data: "Waiting for validator consensus and callback.",
        time: "On-chain",
        requestId,
        status: "active"
      });
    });
    if (target.plaintiffSummary) {
      reconstructed.push({
        agent: "RESEARCH",
        step: "Parsed plaintiff evidence URL",
        data: target.plaintiffSummary,
        time: "On-chain",
        status: "done"
      });
    }
    if (target.defendantSummary) {
      reconstructed.push({
        agent: "RESEARCH",
        step: "Parsed defendant evidence URL",
        data: target.defendantSummary,
        time: "On-chain",
        status: "done"
      });
    }
    if (target.validationSummary) {
      reconstructed.push({ agent: "VALIDATOR", step: "Evidence validation complete", data: target.validationSummary, time: "On-chain", status: "done" });
    }
    if (target.skepticSummary) {
      reconstructed.push({ agent: "SKEPTIC", step: "Cross-examination complete", data: target.skepticSummary, time: "On-chain", status: "done" });
    }
    if (target.verdictJson) {
      reconstructed.push({
        agent: "JUDGE",
        step: `Verdict delivered to ${shortAddress(target.winner)}`,
        data: `${target.confidence}% confidence - ${target.verdictReasoning || target.verdictJson}`,
        time: "On-chain",
        status: "done"
      });
    }

    setCaseEvents(current => ({
      ...current,
      [id.toString()]: reconstructed
    }));

    // Read cache first to prevent missing old transaction hashes
    let cachedCreate = localStorage.getItem(`gavel_create_tx_${id}`);
    let cachedArb = localStorage.getItem(`gavel_arbitration_tx_${id}`);
    let cachedVerdict = localStorage.getItem(`gavel_verdict_tx_${id}`);

    if (cachedCreate) setCreateTxHash(cachedCreate);
    if (cachedArb) setArbitrationTxHash(cachedArb);
    if (cachedVerdict) setVerdictTxHash(cachedVerdict);

    try {
      const disputeIdBigInt = BigInt(id);
      const provider = readContract.runner?.provider || readContract.provider;
      const currentBlock = provider ? Number(await provider.getBlockNumber()) : 0;
      if (currentBlock > 0) {
        const fromBlock = currentBlock > 990 ? currentBlock - 990 : 0;

        // Query DisputeCreated
        if (!cachedCreate) {
          try {
            const createLogs = await readContract.queryFilter(
              readContract.filters.DisputeCreated(disputeIdBigInt),
              fromBlock,
              currentBlock
            );
            if (createLogs.length > 0) {
              setCreateTxHash(createLogs[0].transactionHash);
              localStorage.setItem(`gavel_create_tx_${id}`, createLogs[0].transactionHash);
            } else {
              setCreateTxHash("");
            }
          } catch (e) {
            console.warn("DisputeCreated log query failed:", e.message);
          }
        }

        // Query AgentRequestCreated
        if (!cachedArb) {
          try {
            const arbLogs = await readContract.queryFilter(
              readContract.filters.AgentRequestCreated(disputeIdBigInt),
              fromBlock,
              currentBlock
            );
            if (arbLogs.length > 0) {
              setArbitrationTxHash(arbLogs[0].transactionHash);
              localStorage.setItem(`gavel_arbitration_tx_${id}`, arbLogs[0].transactionHash);
            } else {
              setArbitrationTxHash("");
            }
          } catch (e) {
            console.warn("AgentRequestCreated log query failed:", e.message);
          }
        }

        // Query VerdictDelivered
        if (target.verdictJson && !cachedVerdict) {
          try {
            const verdictLogs = await readContract.queryFilter(
              readContract.filters.VerdictDelivered(disputeIdBigInt),
              fromBlock,
              currentBlock
            );
            if (verdictLogs.length > 0) {
              setVerdictTxHash(verdictLogs[0].transactionHash);
              localStorage.setItem(`gavel_verdict_tx_${id}`, verdictLogs[0].transactionHash);
            } else {
              setVerdictTxHash("");
            }
          } catch (e) {
            console.warn("VerdictDelivered log query failed:", e.message);
          }
        } else if (!target.verdictJson) {
          setVerdictTxHash("");
        }
      }
    } catch (err) {
      console.warn("Could not fetch log tx hashes:", err.message);
    }
  }

  async function loadDispute(id = disputeId, ownedCases = caseList) {
    if (!readContract || id === "") {
      setNotice("Set a deployed contract address and dispute ID first.");
      return;
    }
    try {
      const [dispute, requestIds] = await Promise.all([readContract.getDispute(id), readContract.getStageRequestIds(id)]);
      const normalized = normalizeDispute(dispute, id, address, requestIds);
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
      fetchPastEvents(normalized.id, normalized);
    } catch (error) {
      setNotice(errorMessage(error));
    }
  }

  async function loadReceipt(requestId) {
    const targets = requestId ? [requestId.toString()] : activeDispute?.requestIds || [];
    if (targets.length === 0) {
      setReceiptError("This case has not started arbitration yet, so no Somnia request ID exists.");
      return;
    }
    setReceiptLoading(true);
    setReceiptError("");
    try {
      const manifests = await Promise.all(targets.map(async (target) => {
        const response = await fetch(`${RECEIPTS_URL}/agent-receipts?contractAddress=${SOMNIA_AGENTS_ADDRESS}&requestId=${target}&type=minimal`);
        if (!response.ok) throw new Error(`Receipt ${target} returned ${response.status}`);
        return response.json();
      }));
      setReceipt({ manifests });
    } catch (error) {
      setReceipt(null);
      setReceiptError(error.message);
    } finally {
      setReceiptLoading(false);
      setPage("receipt");
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
      setNotice={setNotice}
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
      joinDispute={joinDispute}
      loadDispute={loadDispute}
      loadMyCases={loadMyCases}
      loadSelectedCase={loadSelectedCase}
      submitEvidence={submitEvidence}
      requestArbitration={requestArbitration}
      retryFailedStage={retryFailedStage}
      recoverFailedDispute={recoverFailedDispute}
      withdrawFunds={withdrawFunds}
      loadReceipt={loadReceipt}
      shareVerdict={shareVerdict}
      verdictTxHash={verdictTxHash}
      createTxHash={createTxHash}
      arbitrationTxHash={arbitrationTxHash}
      receiptLoading={receiptLoading}
      receiptError={receiptError}
      walletWithdrawable={walletWithdrawable}
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
          <div className="hero-visual">
            <div className="jury-console">
              <div className="jury-console-head">
                <div>
                  <div className="jury-kicker">After arbitration starts</div>
                  <div className="jury-case">Gavel handles the entire case</div>
                </div>
                <div className="jury-network"><span /> Running live</div>
              </div>
              <div className="jury-flow">
                <JuryStage number="01" name="Reads plaintiff evidence" detail="Finds the facts supporting the claim" tone="research" />
                <JuryStage number="02" name="Reads defendant evidence" detail="Finds the facts supporting the response" tone="research" />
                <JuryStage number="03" name="Verifies both sides" detail="Checks links, claims, and contradictions" tone="validate" />
                <JuryStage number="04" name="Challenges weak claims" detail="Tests whether either argument is unsupported" tone="challenge" />
                <JuryStage number="05" name="Decides the case and unlocks funds" detail="Records the verdict and makes the payout withdrawable" tone="judge" wide />
              </div>
              <div className="jury-proof">
                <div>
                  <span className="jury-proof-label">Proven live on Somnia</span>
                  <strong>Case #0 completed from evidence to verdict</strong>
                </div>
                <div className="jury-proof-state"><span /> Verdict enforced</div>
              </div>
            </div>
          </div>
          <div className="hero-stats">
            <div className="stat-item"><span className="stat-num">Live</span><span className="stat-label">Working Somnia testnet MVP</span></div>
            <div className="stat-item"><span className="stat-num">1 click</span><span className="stat-label">Starts the complete AI jury</span></div>
            <div className="stat-item"><span className="stat-num">Automatic</span><span className="stat-label">Verdict recorded and funds released</span></div>
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
        <p className="section-sub">No human arbiter and no trusted oracle. Somnia validators execute the agent jury and return consensus results to the escrow contract.</p>
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
          <h2 className="section-title">Five stages.<br />One verdict.</h2>
          <p className="section-sub">Gavel chains Somnia AI agents that debate, cross-check, and reach consensus - just like a real jury.</p>
          <div className="agents-grid">
            {["Plaintiff Research", "Defendant Research", "Evidence Validator", "Skeptic", "Final Judge"].map((name, index) => (
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

function CustomDropdown({ value, options, onChange, loading, placeholder = "Select your case" }) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef(null);

  useEffect(() => {
    function handleClickOutside(event) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const selectedOption = options.find(opt => opt.id === value);

  return (
    <div className="custom-dropdown-container" ref={dropdownRef}>
      <button 
        type="button" 
        className={`custom-dropdown-trigger ${isOpen ? "open" : ""}`}
        onClick={() => setIsOpen(!isOpen)}
        disabled={loading}
      >
        {selectedOption ? (
          <div className="dropdown-trigger-content">
            <span className="dropdown-trigger-id">Case #{selectedOption.id}</span>
            <span className={`badge ${selectedOption.stateLabel === "Resolved" ? "badge-green" : selectedOption.stateLabel === "Expired" ? "badge-red" : "badge-amber"}`}>
              <span className="badge-dot" />{selectedOption.stateLabel}
            </span>
          </div>
        ) : (
          <span className="dropdown-placeholder">{placeholder}</span>
        )}
        <span className="dropdown-arrow">▼</span>
      </button>
      
      {isOpen && (
        <div className="custom-dropdown-menu">
          {options.length === 0 ? (
            <div className="dropdown-empty">No cases found</div>
          ) : (
            options.map((opt) => {
              const isActive = opt.id === value;
              return (
                <div
                  key={opt.id}
                  className={`custom-dropdown-item ${isActive ? "active" : ""}`}
                  onClick={() => {
                    onChange(opt.id);
                    setIsOpen(false);
                  }}
                >
                  <div className="dropdown-item-header">
                    <span className="dropdown-item-id">Case #{opt.id}</span>
                    <span className={`badge ${opt.stateLabel === "Resolved" ? "badge-green" : opt.stateLabel === "Expired" ? "badge-red" : "badge-amber"}`}>
                      <span className="badge-dot" />{opt.stateLabel}
                    </span>
                  </div>
                  <div className="dropdown-item-desc">{opt.description || "No description"}</div>
                </div>
              );
            })
          )}
        </div>
      )}
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
  const activeCases = caseList.filter((entry) => Number(entry.state) >= 0 && Number(entry.state) <= 4).length;
  const resolvedCases = caseList.filter((entry) => Number(entry.state) === 5).length;
  const completedPipelines = caseList.filter((entry) => entry.requestIds?.length === 5 && Number(entry.state) === 5).length;
  const pipelineCoverage = totalCases > 0 ? Math.round((completedPipelines / totalCases) * 100) : 0;
  const resolutionCoverage = totalCases > 0 ? Math.round((resolvedCases / totalCases) * 100) : 0;
  const lockedStake = caseList.reduce(
    (sum, entry) => sum + BigInt(entry.plaintiffDeposit || "0") + BigInt(entry.defendantDeposit || "0"),
    0n
  );
  return (
    <div className="page active">
      <div className="stats-row">
        <StatCard label="Total cases" value={String(totalCases)} sub={loadingCases ? "Loading on-chain cases..." : "Connected wallet cases"} positive />
        <StatCard label="Active disputes" value={String(activeCases)} sub="Awaiting evidence or arbitration" amber />
        <StatCard label="Funds in escrow" value={formatStt(lockedStake)} sub="STT locked" />
        <StatCard label="Verdicts issued" value={String(resolvedCases)} sub="On-chain outcomes" positive />
      </div>
      <div className="card">
        <div className="card-header"><div><div className="card-title">Recent cases</div><div className="card-subtitle">Your disputes and arbitrations</div></div><button className="btn btn-outline" onClick={() => setPage("cases")}>View all</button></div>
        <CaseTable setPage={setPage} caseList={caseList} loadSelectedCase={loadSelectedCase} loadReceipt={loadReceipt} compact />
      </div>
      <div className="overview-grid">
        <div className="card metric-card">
          <div className="card-title">Autonomous pipeline proof</div>
          <ProgressRow label="Completed all five agent stages" value={pipelineCoverage} />
          <ProgressRow label="Reached an on-chain verdict" value={resolutionCoverage} />
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
            <div className="form-group"><label>Your stake amount</label><div className="stake-input-wrap"><input name="stake" type="number" required min="0.001" step="0.001" defaultValue="0.01" /><span className="stake-suffix">STT</span></div><div className="form-hint">Defendant must match this amount to join</div></div>
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

function Evidence({ disputeId, activeDispute, caseList, loadSelectedCase, submitEvidence, requestArbitration, retryFailedStage, recoverFailedDispute, withdrawFunds, joinDispute, busy, loadingCases, address }) {
  const currentCase = activeDispute || caseList.find((entry) => entry.id === disputeId) || null;
  const canArbitrate = currentCase && currentCase.plaintiffEvidenceUrl && currentCase.defendantEvidenceUrl;
  const state = Number(currentCase?.state ?? -1);
  const isOpen = state === 0;
  const isEvidenceStage = state === 1 || state === 2;
  const isDefendant = Boolean(address && currentCase?.defendant?.toLowerCase?.() === address.toLowerCase());
  const isPlaintiff = Boolean(address && currentCase?.plaintiff?.toLowerCase?.() === address.toLowerCase());

  const plaintiffDisabledReason = !isEvidenceStage
    ? (isOpen ? "Defendant must join before evidence can be submitted." : "Evidence window is closed.")
    : (!isPlaintiff ? "Only the plaintiff can submit plaintiff evidence." : "");

  const defendantDisabledReason = !isEvidenceStage
    ? (isOpen ? "Defendant must join before evidence can be submitted." : "Evidence window is closed.")
    : (!isDefendant ? "Only the defendant can submit defendant evidence." : "");

  return (
    <div className="page active">
      <div className="case-loader">
        <CustomDropdown 
          value={disputeId} 
          options={caseList} 
          onChange={loadSelectedCase} 
          loading={loadingCases} 
          placeholder="Select your case" 
        />
        <button className="btn btn-outline" onClick={() => loadSelectedCase(disputeId)} disabled={!disputeId || loadingCases}>Load</button>
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
          {isOpen && (
            <div className="card join-card">
              <div className="card-pad join-card-inner">
                <div>
                  <div className="card-title">Defendant join required</div>
                  <div className="card-subtitle">The defendant must join with exactly {formatStt(currentCase.plaintiffDeposit)} STT before either side can submit evidence.</div>
                </div>
                <button className="btn btn-dark" onClick={joinDispute} disabled={busy || !isDefendant}>
                  {busy ? "Joining..." : isDefendant ? `Join with ${formatStt(currentCase.plaintiffDeposit)} STT` : "Awaiting Defendant"}
                </button>
              </div>
            </div>
          )}
          <div className="evidence-layout">
            <EvidenceParty title="Plaintiff" address={currentCase.plaintiff} url={currentCase.plaintiffEvidenceUrl} side="plaintiff" onSubmit={submitEvidence} busy={busy || !isEvidenceStage || !isPlaintiff} disabledReason={plaintiffDisabledReason} />
            <EvidenceParty title="Defendant" address={currentCase.defendant} url={currentCase.defendantEvidenceUrl} side="defendant" onSubmit={submitEvidence} busy={busy || !isEvidenceStage || !isDefendant} disabledReason={defendantDisabledReason} />
          </div>
          <div className="card timeline-card">
            <div className="card-header"><div className="card-title">Evidence timeline</div></div>
            <ReceiptTimeline receipt={null} />
          </div>
          {isEvidenceStage && (
            <div className="arbitration-action-card">
              <div className="arbitration-action-header">
                <div>
                  <div className="arbitration-action-title">Request Somnia Arbitration</div>
                  <div className="arbitration-action-subtitle">
                    Launch the validator-executed agent jury to Deliberate and Deliver the Verdict.
                  </div>
                </div>
                <div className="arbitration-budget-inputs">
                  <span>Agent Budget:</span>
                  <input data-agent-budget type="number" min="1.28" step="0.01" defaultValue="1.28" className="stake-input" />
                  <span className="mono">STT</span>
                  <button className="btn btn-dark" onClick={requestArbitration} disabled={busy || !canArbitrate}>
                    {busy ? "Starting..." : "Request arbitration →"}
                  </button>
                </div>
              </div>
              <div className="budget-help-card">
                <div className="budget-help-title">💡 About Somnia Agent Validation & Budgets</div>
                <div className="budget-help-text">
                  The Gavel contract funds five autonomous Somnia requests: two evidence researchers, a validator, a skeptic, and a final judge.
                  <ul style={{ marginLeft: "1.25rem", marginTop: "4px" }}>
                    <li><strong>Research:</strong> Both evidence URLs are independently parsed by validator-executed agents.</li>
                    <li><strong>Deliberation:</strong> Validator and skeptic agents challenge the evidence record.</li>
                    <li><strong>Judge:</strong> A strict-format consensus verdict controls escrow credits.</li>
                  </ul>
                  Any unused initial budget is credited for withdrawal after resolution.
                </div>
              </div>
            </div>
          )}
          {state === 4 && (
            <div className="card join-card" style={{ borderLeft: "4px solid var(--accent)" }}>
              <div className="card-pad join-card-inner">
                <div><div className="card-title">Agent stage failed</div><div className="card-subtitle">Retry immediately, or recover escrow after the one-day safety delay.</div></div>
                <div className="right-actions">
                  <button className="btn btn-dark" onClick={retryFailedStage} disabled={busy}>Retry failed stage</button>
                  <button className="btn btn-outline" onClick={recoverFailedDispute} disabled={busy}>Recover escrow</button>
                  <button className="btn btn-outline" onClick={withdrawFunds} disabled={busy}>Withdraw credited funds</button>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function LiveHearing({ events, activeDispute, disputeId, loadReceipt, caseList, loadSelectedCase, loadingCases }) {
  const hasRequest = Boolean(activeDispute?.latestRequestId);
  const state = Number(activeDispute?.state ?? -1);
  const isHearingComplete = state >= 4;
  const isHearingActive = state === 3;
  return (
    <div className="page active">
      <div className="case-loader">
        <CustomDropdown 
          value={disputeId} 
          options={caseList} 
          onChange={loadSelectedCase} 
          loading={loadingCases} 
          placeholder="Select your case" 
        />
        <button className="btn btn-outline" onClick={() => loadSelectedCase(disputeId)} disabled={!disputeId || loadingCases}>Load</button>
      </div>

      {!activeDispute ? (
        <div className="card">
          <div className="card-pad">
            <div className="empty-state">Select one of your on-chain disputes to view evidence, hearing, verdict, and receipt.</div>
          </div>
        </div>
      ) : (
        <>
          <div 
            className="hearing-banner" 
            style={isHearingComplete ? { background: "var(--green-bg)", borderColor: "#A8D8BA" } : undefined}
          >
            <div className={`feed-status-dot ${isHearingComplete ? "dot-green" : isHearingActive ? "dot-amber" : "dot-amber"}`} style={isHearingComplete ? { animation: "none" } : undefined} />
            <span style={isHearingComplete ? { color: "var(--green)" } : undefined}>
              Case #{disputeId || "—"} - {hasRequest ? `Somnia request #${activeDispute.latestRequestId}` : "Waiting for arbitration to start"}
            </span>
            <span style={isHearingComplete ? { color: "var(--green)" } : undefined}>
              {isHearingComplete ? "Arbitration Complete" : hasRequest ? "Live hearing" : "No request yet"}
            </span>
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
            <StatMini label="Escrow locked" value={activeDispute ? `${formatStt(BigInt(activeDispute.plaintiffDeposit || "0") + BigInt(activeDispute.defendantDeposit || "0"))} STT` : "0 STT"} sub="Auto-releases on verdict" />
            <StatMini label="Latest request" value={activeDispute?.latestRequestId || "—"} sub={activeDispute?.latestRequestId ? "Available on Somnia" : "No request yet"} />
            <StatMini label="Status" value={activeDispute?.stateLabel || "No case"} sub="Selected wallet case" />
          </div>
          <div className="right-actions"><button className="btn btn-outline" onClick={() => loadReceipt()} disabled={!hasRequest}>Open latest receipt</button></div>
        </>
      )}
    </div>
  );
}

function Verdict({ activeDispute, disputeId, loadReceipt, shareVerdict, withdrawFunds, caseList, loadSelectedCase, loadingCases, busy, verdictTxHash, createTxHash, arbitrationTxHash, walletWithdrawable }) {
  const confidence = Number(activeDispute?.confidence || 0);
  const reasoning = activeDispute?.verdictReasoning || "No verdict has been delivered for this case yet.";
  const verdictReady = Boolean(activeDispute?.verdictJson);
  const isSplitVerdict = verdictReady && !activeDispute?.winner;
  const winner = !verdictReady ? "Awaiting verdict" : isSplitVerdict ? "Split verdict" : shortAddress(activeDispute.winner);
  const availableCredit = BigInt(walletWithdrawable || 0);
  const payoutStatus = availableCredit > 0n
    ? `${formatStt(availableCredit)} STT ready to withdraw`
    : verdictReady
      ? "No pending withdrawal - credited funds already withdrawn"
      : "Awaiting verdict";

  const [winnerBalance, setWinnerBalance] = useState("");

  useEffect(() => {
    if (activeDispute?.winner) {
      const provider = new ethers.JsonRpcProvider("https://dream-rpc.somnia.network");
      provider.getBalance(activeDispute.winner)
        .then((bal) => {
          setWinnerBalance(Number(ethers.formatEther(bal)).toLocaleString(undefined, {
            maximumFractionDigits: 4,
            minimumFractionDigits: 4
          }));
        })
        .catch(() => {});
    }
  }, [activeDispute?.winner]);

  const totalStake = BigInt(activeDispute?.plaintiffDeposit || "0") + BigInt(activeDispute?.defendantDeposit || "0");

  return (
    <div className="page active">
      <div className="case-loader">
        <CustomDropdown 
          value={disputeId} 
          options={caseList} 
          onChange={loadSelectedCase} 
          loading={loadingCases} 
          placeholder="Select your case" 
        />
        <button className="btn btn-outline" onClick={() => loadSelectedCase(disputeId)} disabled={!disputeId || loadingCases}>Load</button>
      </div>

      {!activeDispute ? (
        <div className="card">
          <div className="card-pad">
            <div className="empty-state">Select one of your on-chain disputes to view evidence, hearing, verdict, and receipt.</div>
          </div>
        </div>
      ) : (
        <>
          <div className="verdict-box">
            <div className="verdict-label">Case #{disputeId || "—"} · Final verdict</div>
            <div className="verdict-winner">⚖ {winner}</div>
            <div className="verdict-conf-row"><div className="verdict-conf-bar"><div className="verdict-conf-fill" style={{ width: `${confidence}%` }} /></div><span>{confidence}% confidence</span></div>
            <div className="verdict-reason">{verdictReady ? `"${reasoning}"` : "No verdict has been recorded for this case yet."}</div>
          </div>
          <div className="verdict-meta-row">
            <Meta label="Winner receives" value={!verdictReady ? "Waiting" : activeDispute?.winner ? "Full escrow credit" : "Split escrow credit"} green={verdictReady} />
            <Meta label="Verdict issued" value={verdictReady ? "On-chain" : "Pending"} />
            <Meta label="Auto-executed" value={verdictReady ? "✓ Yes" : "Pending"} green={verdictReady} />
          </div>

          <div className="card tx-card">
            <div className="card-header"><div className="card-title">Transaction details & explorer links</div></div>
            <div className="card-pad" style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
              {verdictReady ? (
                <>
                  <TxRow label="Latest request ID" value={activeDispute.latestRequestId} />
                  <TxRow label="State" value={activeDispute.stateLabel} />
                  <TxRow label="Agent budget" value={`${formatStt(activeDispute.agentBudget)} STT`} />
                  <TxRow label="Winner Address" value={activeDispute.winner ? activeDispute.winner : "Not applicable - split verdict"} />
                  <TxRow label="Escrow currently locked" value={`${formatStt(totalStake)} STT`} />
                  <TxRow label="Payout model" value="Credited for secure withdrawal" green />
                  {winnerBalance && (
                    <TxRow label="Winner Wallet Balance (On-Chain)" value={`${winnerBalance} STT`} green />
                  )}
                  {createTxHash && (
                    <TxRow 
                      label="Case Creation Transaction" 
                      value={
                        <a href={`https://shannon-explorer.somnia.network/tx/${createTxHash}`} target="_blank" rel="noopener noreferrer" className="action-link">
                          View Creation Transaction
                        </a>
                      } 
                    />
                  )}
                  {arbitrationTxHash && (
                    <TxRow 
                      label="Arbitration Request Transaction" 
                      value={
                        <a href={`https://shannon-explorer.somnia.network/tx/${arbitrationTxHash}`} target="_blank" rel="noopener noreferrer" className="action-link">
                          View Arbitration Transaction
                        </a>
                      } 
                    />
                  )}
                  {verdictTxHash && (
                    <TxRow 
                      label="Verdict Transaction"
                      value={
                        <a href={`https://shannon-explorer.somnia.network/tx/${verdictTxHash}`} target="_blank" rel="noopener noreferrer" className="action-link">
                          View Verdict Transaction
                        </a>
                      } 
                    />
                  )}
                  <TxRow label="Connected Wallet Payout" value={payoutStatus} green={verdictReady} />
                </>
              ) : (
                <div className="empty-state">This case is still waiting for arbitration, so there is no verdict receipt to show yet.</div>
              )}
            </div>
          </div>
          <div className="form-actions">
            <button className="btn btn-dark" onClick={() => loadReceipt()} disabled={!activeDispute?.latestRequestId}>View audit receipt →</button>
            <button className="btn btn-outline" onClick={withdrawFunds} disabled={busy || availableCredit === 0n}>Withdraw credited funds</button>
            <button className="btn btn-outline" onClick={shareVerdict} disabled={!verdictReady}>Share verdict</button>
          </div>
        </>
      )}
    </div>
  );
}

function Receipt({ receipt, activeDispute, disputeId, caseList, loadSelectedCase, loadingCases, loadReceipt, receiptLoading, receiptError, setNotice }) {
  const displayReceipt = receipt;

  async function exportReceipt() {
    const dataToExport = displayReceipt;
    if (!dataToExport) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify(dataToExport, null, 2));
      setNotice("Receipt JSON copied to clipboard.");
    } catch (error) {
      console.error(error);
    }
  }

  function downloadReceipt() {
    const dataToExport = displayReceipt;
    if (!dataToExport) return;
    try {
      const blob = new Blob([JSON.stringify(dataToExport, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `gavel-receipt-case-${disputeId}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setNotice("Receipt downloaded successfully.");
    } catch (error) {
      console.error(error);
    }
  }

  React.useEffect(() => {
    if (activeDispute?.requestIds?.length && !receipt && !loadingCases) {
      loadReceipt();
    }
  }, [activeDispute?.latestRequestId]);

  return (
    <div className="page active">
      <div className="case-loader">
        <CustomDropdown 
          value={disputeId} 
          options={caseList} 
          onChange={loadSelectedCase} 
          loading={loadingCases} 
          placeholder="Select your case" 
        />
        <button className="btn btn-outline" onClick={() => loadSelectedCase(disputeId)} disabled={!disputeId || loadingCases}>Load</button>
      </div>

      {!activeDispute ? (
        <div className="card">
          <div className="card-pad">
            <div className="empty-state">Select one of your on-chain disputes to view evidence, hearing, verdict, and receipt.</div>
          </div>
        </div>
      ) : (
        <>

          <div className="receipt-top-card">
            <div className="receipt-top-info">
              <div className="muted">Audit receipt details</div>
              <div className="receipt-case-meta">
                <span className="receipt-case-id">Case #{disputeId || "—"}</span>
                {activeDispute && <span className="receipt-case-desc">{activeDispute.description}</span>}
              </div>
            </div>
            <div className="receipt-top-actions">
              <span className="badge badge-green">
                <span className="badge-dot" />
                {displayReceipt ? "Validator receipts loaded" : "Waiting for receipt service"}
              </span>
              <button className="btn btn-outline" onClick={exportReceipt} disabled={!displayReceipt}>Copy JSON</button>
              <button className="btn btn-dark" onClick={downloadReceipt} disabled={!displayReceipt}>Download JSON</button>
            </div>
          </div>
          <div className="card">
            <div className="card-header"><div><div className="card-title">Validator execution receipts</div><div className="card-subtitle">{displayReceipt ? "Execution traces from Somnia validators; the consensus result is recorded onchain" : receiptLoading ? "Loading Somnia receipts..." : receiptError || "No receipts indexed yet"}</div></div></div>
            <ReceiptTimeline receipt={displayReceipt} />
          </div>
          <div className="receipt-note">🔏 Receipt results are auditable; callback result controls escrow.</div>
        </>
      )}
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
          <th>Locked now</th>
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
              setPage(row.action.page);
            }}
          >
            <td className="mono">#{row.id}</td>
            <td>{row.description || "No description"}</td>
            <td><span className="badge badge-gray">{row.role}</span></td>
            <td className="mono">{formatStt(BigInt(row.plaintiffDeposit || "0") + BigInt(row.defendantDeposit || "0"))} STT</td>
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

  const manifests = receipt.manifests || [];
  if (manifests.length > 0) {
    return <div className="receipt-timeline">{manifests.flatMap((manifest, stageIndex) =>
      (manifest.receipts || []).map((validatorReceipt, validatorIndex) => (
        <ReceiptStep
          key={`${manifest.requestId}-${validatorReceipt.agentRunnerAddress || validatorIndex}`}
          name={`${stageName(stageIndex + 1)} - validator ${validatorIndex + 1}`}
          time={`${validatorReceipt.elapsedMs || 0} ms`}
          detail={`Request #${manifest.requestId} | ${validatorReceipt.status} | ${validatorReceipt.agentRunnerAddress || "validator"}`}
          code={JSON.stringify(validatorReceipt, null, 2)}
        />
      ))
    )}</div>;
  }
  return <div className="receipt-timeline"><div className="empty-state">Somnia has not indexed validator receipts for these requests yet.</div></div>;
}

function JuryStage({ number, name, detail, tone, wide }) {
  return <div className={`jury-stage jury-stage-${tone} ${wide ? "jury-stage-wide" : ""}`}>
    <span className="jury-stage-number">{number}</span>
    <div><strong>{name}</strong><span>{detail}</span></div>
    <span className="jury-stage-status">Automatic</span>
  </div>;
}
function StepCard({ num, icon, title, text }) { return <div className="step-card"><div className="step-num">{num}</div><div className="step-icon-box">{icon}</div><h3>{title}</h3><p>{text}</p></div>; }
function UseCase({ icon, title, text, tag }) { return <div className="usecase-card"><div className="usecase-icon">{icon}</div><h3>{title}</h3><p>{text}</p><div className="usecase-tag">→ {tag}</div></div>; }
function NavItem({ active, icon, label, onClick }) { return <button className={`nav-item ${active ? "active" : ""}`} onClick={onClick}><span className="nav-icon">{icon}</span>{label}</button>; }
function StatCard({ label, value, sub, positive, amber }) { return <div className="stat-card"><div className="stat-card-label">{label}</div><div className="stat-card-value">{value}</div><div className={`stat-card-sub ${positive ? "stat-positive" : ""}`} style={amber ? { color: "var(--amber)" } : undefined}>{sub}</div></div>; }
function ProgressRow({ label, value }) { return <div className="progress-row"><div><span>{label}</span><span className="mono">{value}% success</span></div><div><span style={{ width: `${value}%` }} /></div></div>; }
function Distribution({ color, label, value }) { return <div className="distribution"><span style={{ background: color }} /><p>{label}</p><b className="mono">{value}</b></div>; }
function StepInd({ active, label, num }) { return <div className={`step-ind ${active ? "active" : ""}`}><div className="step-ind-circle">{num}</div><span className="step-ind-label">{label}</span></div>; }
function EvidenceParty({ title, address, url, side, onSubmit, busy, disabledReason }) { return <div className="evidence-party"><div className="party-label">{title}</div><div className="party-addr">{typeof address === "string" ? address : shortAddress(address)}</div>{url ? <div className="evidence-item"><div className="evidence-icon">🔗</div><div><div className="evidence-url">{url}</div><div className="evidence-status">✓ Submitted · Ready for agent parse</div></div></div> : <div className="empty-small">Waiting for evidence</div>}<div className="evidence-submit"><label>Add evidence</label><input data-evidence={side} type="url" placeholder="https://..." disabled={busy} />{disabledReason && <div className="form-hint">{disabledReason}</div>}<button className="btn btn-dark" onClick={() => onSubmit(side)} disabled={busy}>Submit evidence URL</button></div></div>; }
function FeedItem({ event }) { return <div className="feed-item"><div className={`feed-status-dot ${event.status === "active" ? "dot-amber" : "dot-green"}`} /><div className="feed-agent-badge">{event.agent}</div><div className="feed-content"><div className="feed-step">{event.step}</div><div className="feed-detail">{event.data}</div></div><div className="feed-time">{event.time}</div></div>; }
function StatMini({ label, value, sub }) { return <div className="card mini-stat"><div>{label}</div><strong>{value}</strong><span>{sub}</span></div>; }
function Meta({ label, value, green }) { return <div className="verdict-meta-card"><div className="verdict-meta-label">{label}</div><div className="verdict-meta-value" style={green ? { color: "var(--green)" } : undefined}>{value}</div></div>; }
function TxRow({ label, value, green }) { return <div className="tx-row"><span>{label}</span><span className="mono" style={green ? { color: "var(--green)" } : undefined}>{value}</span></div>; }
function parseClaims(text) {
  if (!text) return [];
  const regex = /\{[^{}]+\}/g;
  const matches = text.match(regex) || [];
  const claims = [];
  for (const match of matches) {
    try {
      const normalized = match
        .replace(/'/g, '"')
        .replace(/\\"/g, '"');
      const parsed = JSON.parse(normalized);
      if (parsed.claim) {
        claims.push(parsed);
      }
    } catch (e) {
      // ignore parsing errors for single corrupted items
    }
  }
  return claims;
}

function ClaimsList({ claims }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "8px", marginTop: "8px" }}>
      {claims.map((c, index) => (
        <div key={index} style={{ 
          background: "var(--cream)", 
          border: "1px solid var(--border)", 
          borderRadius: "8px", 
          padding: "10px 12px",
          display: "flex",
          flexDirection: "column",
          gap: "4px"
        }}>
          <div style={{ fontSize: "0.875rem", fontWeight: "500", color: "var(--ink)" }}>
            {c.claim}
          </div>
          <div style={{ display: "flex", gap: "10px", alignItems: "center", fontSize: "0.75rem", color: "var(--ink-muted)" }}>
            <span>📅 {c.timestamp || "No date"}</span>
            <span className={`badge ${c.sourceCredibility?.toLowerCase() === "high" ? "badge-green" : "badge-gray"}`}>
              {c.sourceCredibility || "Medium"} credibility
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

function VerdictDetails({ verdict }) {
  return (
    <div style={{ 
      background: "var(--ink)", 
      color: "white",
      borderRadius: "12px", 
      padding: "1.25rem",
      marginTop: "8px",
      display: "flex",
      flexDirection: "column",
      gap: "10px"
    }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ fontSize: "0.8125rem", color: "rgba(255,255,255,0.5)", textTransform: "uppercase", letterSpacing: "0.05em" }}>DECISION DELIVERED</span>
        <span className="badge badge-green" style={{ background: "var(--accent)", color: "white", border: "none" }}>
          🏆 Winner: {verdict.winner}
        </span>
      </div>
      <div style={{ fontSize: "1.125rem", fontWeight: "600", fontFamily: "'Playfair Display', serif" }}>
        "{verdict.reasoning}"
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: "12px", marginTop: "4px" }}>
        <div style={{ flex: 1, height: "6px", background: "rgba(255,255,255,0.15)", borderRadius: "3px", overflow: "hidden" }}>
          <div style={{ width: `${verdict.confidence}%`, height: "100%", background: "#4ADE80" }} />
        </div>
        <span style={{ fontSize: "0.75rem", color: "#4ADE80", fontWeight: "600" }}>{verdict.confidence}% confidence</span>
      </div>
    </div>
  );
}

function ReceiptStep({ name, time, detail, code }) {
  const [expanded, setExpanded] = useState(false);

  // Check if detail represents parsed claims
  const isClaimsStep = name.toLowerCase().includes("claims") || detail.includes("LLM parsed plaintiff claims") || detail.includes("LLM parsed defendant claims");
  const claims = isClaimsStep ? parseClaims(detail) : [];

  // Check if detail represents judge deliberation
  const isVerdictStep = name.toLowerCase().includes("deliberation") || detail.includes("Verdict JSON");
  let verdictObj = null;
  if (isVerdictStep) {
    try {
      const jsonStart = detail.indexOf("{");
      if (jsonStart !== -1) {
        verdictObj = JSON.parse(detail.substring(jsonStart).trim());
      }
    } catch (e) {
      // ignore
    }
  }

  return (
    <div className="receipt-step">
      <div className="receipt-step-header">
        <span className="receipt-step-name" style={{ textTransform: "capitalize" }}>
          {name.replace(/_/g, " ")}
        </span>
        <span className="receipt-step-time">{time}</span>
      </div>
      <div className="receipt-step-detail">
        {claims.length > 0 ? (
          <div>
            <div style={{ fontWeight: "500", marginBottom: "4px" }}>
              {detail.split(":")[0] || "LLM parsed claims"}:
            </div>
            <ClaimsList claims={claims} />
          </div>
        ) : verdictObj ? (
          <div>
            <div style={{ fontWeight: "500", marginBottom: "4px" }}>
              {detail.split(":")[0] || "Judge deliberation complete"}:
            </div>
            <VerdictDetails verdict={verdictObj} />
          </div>
        ) : (
          detail
        )}
      </div>
      <div className="receipt-step-expand" style={{ marginTop: "6px" }}>
        <button 
          type="button" 
          onClick={() => setExpanded(!expanded)}
          style={{ 
            background: "none", 
            border: "none", 
            color: "var(--accent)", 
            fontSize: "0.75rem", 
            fontWeight: "500",
            cursor: "pointer", 
            padding: "4px 0", 
            display: "flex", 
            alignItems: "center", 
            gap: "4px" 
          }}
        >
          {expanded ? "Hide raw JSON ▴" : "Show raw JSON ▾"}
        </button>
        {expanded && <pre className="receipt-code" style={{ whiteSpace: "pre-wrap", wordBreak: "break-all" }}><code>{code}</code></pre>}
      </div>
    </div>
  );
}
function StatusBadge({ status }) { const cls = status === "Resolved" ? "badge-green" : status === "Expired" ? "badge-red" : "badge-amber"; return <span className={`badge ${cls}`}><span className="badge-dot" />{status}</span>; }

function agentCopy(name) {
  return {
    "Plaintiff Research": "Extracts factual claims and supporting details from the plaintiff evidence.",
    "Defendant Research": "Builds an independent factual record from the defendant evidence.",
    "Evidence Validator": "Checks accessibility, contradictions, timestamps, and claim support.",
    "Skeptic": "Challenges both arguments and identifies unsupported conclusions.",
    "Final Judge": "Synthesises every prior output into a strict, binding verdict."
  }[name];
}

function safeParse(contract, log) {
  try { return contract.interface.parseLog(log); } catch { return null; }
}
function stageName(stage) { return ["None", "Plaintiff Research", "Defendant Research", "Validator", "Skeptic", "Judge"][stage] || "Agent"; }
function shortAddress(value) { if (!value) return "0x..."; return `${value.slice(0, 6)}...${value.slice(-4)}`; }

createRoot(document.getElementById("root")).render(<Root />);
