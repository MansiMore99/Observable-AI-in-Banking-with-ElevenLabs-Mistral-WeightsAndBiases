"""
SecureBank AI Backend
Stack: Mistral (LLM) + W&B Weave (tracing) + ElevenLabs (STT)
"""
import os
import yaml
import uuid
import logging
import threading
import requests
from pathlib import Path
from flask import Flask, request, jsonify
from flask_cors import CORS

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = Flask(__name__)
CORS(app)

# ---------------------------------------------------------------------------
# Keys (loaded from environment — set in .env, sourced by start.sh)
# ---------------------------------------------------------------------------
MISTRAL_API_KEY    = os.environ.get("MISTRAL_API_KEY", "")
ELEVENLABS_API_KEY = os.environ.get("ELEVENLABS_API_KEY", "")
WANDB_API_KEY      = os.environ.get("WANDB_API_KEY", "")
WANDB_ENTITY       = os.environ.get("WANDB_ENTITY", "")
WANDB_PROJECT      = os.environ.get("WANDB_PROJECT", "mistral-hackathon")

# ---------------------------------------------------------------------------
# W&B Weave — tracing
# ---------------------------------------------------------------------------
WEAVE_ENABLED = False
RESOLVED_ENTITY = WANDB_ENTITY  # fallback; overwritten after login below
try:
    import wandb
    import weave
    if WANDB_API_KEY:
        wandb.login(key=WANDB_API_KEY, relogin=True)
        # Resolve the actual entity from the API key so the URL is always correct
        try:
            RESOLVED_ENTITY = wandb.Api().default_entity or WANDB_ENTITY
        except Exception:
            pass
        weave.init(f"{RESOLVED_ENTITY}/{WANDB_PROJECT}")
        WEAVE_ENABLED = True
        logger.info(f"Weave tracing active → {RESOLVED_ENTITY}/{WANDB_PROJECT}")
except Exception as e:
    logger.warning(f"Weave not available: {e}")

# ---------------------------------------------------------------------------
# Mistral client
# ---------------------------------------------------------------------------
mistral_client = None
try:
    from mistralai import Mistral
    if MISTRAL_API_KEY:
        mistral_client = Mistral(api_key=MISTRAL_API_KEY)
        logger.info("Mistral client ready")
except Exception as e:
    logger.warning(f"Mistral not available: {e}")

# ---------------------------------------------------------------------------
# Demo scenario config
# ---------------------------------------------------------------------------
CONFIG_PATH = Path(__file__).resolve().parent.parent / "config.yaml"
with open(CONFIG_PATH) as f:
    config = yaml.safe_load(f)

# ---------------------------------------------------------------------------
# Banking system instruction (mirrors constants.ts)
# ---------------------------------------------------------------------------
SYSTEM_INSTRUCTION = """You are the SecureBank Virtual Assistant, a dedicated customer support AI for SecureBank, a retail banking institution.
Your goal is to assist customers with account inquiries, money transfers, joint account creation, and senior citizen services.

CRITICAL SECURITY & PRIVACY RULES:
1. NEVER reveal or ask for full Social Security Numbers (SSN).
2. NEVER reveal full account numbers. Only refer to accounts by their last 4 digits.
3. If a user provides sensitive data (like a full SSN), politely remind them to only provide the last 4 digits.
4. Do not hallucinate user data. If you need an account identifier, ask for the last 4 digits.
5. NEVER reveal dates of birth, email addresses, or phone numbers from account records.
6. If a customer asks for their SSN or full account number, direct them to visit a branch with photo ID.
7. If a customer shares their SSN or credit card number, warn them not to share sensitive information in this channel.

BANKING POLICY DOCUMENTS:

--- MONEY TRANSFER POLICY ---
Transfer Methods:
1. Internal Transfer (SecureBank to SecureBank): FREE, Instant, Daily limit $25,000, Monthly limit $100,000.
2. External Transfer (ACH): FREE standard (3-5 days), $3.00 next-day. Daily $10,000, Monthly $50,000.
3. Wire Transfer (Domestic): $25 outgoing, $15 incoming. Same day if before 4PM EST. Daily $50,000.
4. Wire Transfer (International): $45 outgoing, $15 incoming. 1-3 business days. Daily $25,000.
5. SecureBank Pay (P2P): FREE. Instant for SecureBank customers, 1-2 days otherwise. Daily $5,000.

Security: All transfers over $1,000 require 2FA. First-time transfers >$2,500 have a 24-hour hold.
Wire transfers CANNOT be cancelled once sent. A recall request costs $25 with no guarantee.
ACH transfers can be cancelled within 30 minutes of initiation if not yet processed.

--- JOINT ACCOUNT POLICY ---
Types: Joint Checking ($12/month, waived with $1,500 balance) and Joint Savings (4.25% APY >$10k).
Requirements: All holders must be 18+, US citizens/residents, valid SSN/ITIN.
Documents needed: Two government-issued photo IDs, SSN card, proof of address (within 60 days), application form.
Minimum deposits: Checking $500, Savings $1,000.
Senior citizens (65+): MUST apply in-person at a branch. Online opening NOT available for 65+.

--- SENIOR CITIZEN SERVICES (65+) ---
SecureGold Checking: No monthly fee, free checks, free cashier's checks (5/month), free ATM nationwide.
SecureGold Savings: 4.50% APY for balances >$10,000.
Support: Dedicated Senior Banking Specialists at all branches. Phone: 1-800-SECURE-SR (Mon-Sat 8am-8pm EST).
Senior Fraud Protection: Alerts for unusual activity, verification calls for large transfers.

TONE & STYLE:
- Professional, trustworthy, empathetic, and concise.
- Use bullet points for complex information.
- Keep responses under 150 words unless explaining a complex policy.
- Base answers STRICTLY on the banking policy documents above.
- If something is not covered, say you don't have that information and suggest calling 1-800-SECURE-BANK.
"""

# ---------------------------------------------------------------------------
# Core Mistral call — wrapped with @weave.op() for automatic tracing
# ---------------------------------------------------------------------------
def _mistral_chat(messages: list, session_id: str = "") -> str:
    if not mistral_client:
        return "Mistral is not configured. Please check MISTRAL_API_KEY."
    full_messages = [{"role": "system", "content": SYSTEM_INSTRUCTION}] + messages
    response = mistral_client.chat.complete(
        model="mistral-large-latest",
        messages=full_messages,
        temperature=0.2,
    )
    return response.choices[0].message.content

def _log_demo_turn(question: str, context: str, wrong_answer: str, demo_type: str) -> str:
    """Records a deliberately wrong demo answer — Weave will flag low quality."""
    return wrong_answer

if WEAVE_ENABLED:
    call_mistral   = weave.op()(_mistral_chat)
    log_demo_trace = weave.op()(_log_demo_turn)
else:
    call_mistral   = _mistral_chat
    log_demo_trace = _log_demo_turn

# ---------------------------------------------------------------------------
# API Endpoints
# ---------------------------------------------------------------------------

@app.route("/api/chat", methods=["POST"])
def chat():
    """Chat with Mistral — auto-traced by W&B Weave."""
    try:
        data = request.json
        messages   = data.get("messages", [])
        session_id = data.get("session_id", str(uuid.uuid4()))

        if not messages:
            return jsonify({"success": False, "error": "No messages provided"}), 400

        response_text = call_mistral(messages, session_id)
        return jsonify({"success": True, "text": response_text}), 200

    except Exception as e:
        logger.error(f"Chat error: {e}")
        return jsonify({"success": False, "error": str(e)}), 200


@app.route("/api/transcribe", methods=["POST"])
def transcribe():
    """ElevenLabs speech-to-text."""
    try:
        if "audio" not in request.files:
            return jsonify({"success": False, "error": "No audio file"}), 400

        audio_file = request.files["audio"]
        el_response = requests.post(
            "https://api.elevenlabs.io/v1/speech-to-text",
            headers={"xi-api-key": ELEVENLABS_API_KEY},
            files={"file": (
                audio_file.filename or "recording.webm",
                audio_file.stream,
                audio_file.mimetype or "audio/webm",
            )},
            data={"model_id": "scribe_v1"},
        )

        if el_response.status_code != 200:
            logger.error(f"ElevenLabs error {el_response.status_code}: {el_response.text}")
            return jsonify({"success": False, "error": f"ElevenLabs returned {el_response.status_code}"}), 200

        text = el_response.json().get("text", "")
        return jsonify({"success": True, "text": text}), 200

    except Exception as e:
        logger.error(f"Transcription error: {e}")
        return jsonify({"success": False, "error": str(e)}), 200


@app.route("/api/wb-url", methods=["GET"])
def get_wb_url():
    """Return the W&B Weave traces URL using the resolved (actual) entity."""
    if RESOLVED_ENTITY and WANDB_PROJECT:
        url = f"https://wandb.ai/{RESOLVED_ENTITY}/{WANDB_PROJECT}/weave"
    else:
        url = None
    return jsonify({"url": url, "entity": RESOLVED_ENTITY, "project": WANDB_PROJECT}), 200


@app.route("/api/log-demo", methods=["POST"])
def log_demo():
    """Log a pre-configured demo trace to W&B Weave (background thread)."""
    try:
        data      = request.json
        demo_type = data.get("demo_type", "hallucination")
        index     = data.get("index", 0)
        session_id = data.get("session_id", str(uuid.uuid4()))

        DEMO_CONFIG = {
            "hallucination":    ("demo_hallucinations",   "Hallucination Demo"),
            "pii":              ("demo_pii_issues",        "PII Leak Demo"),
            "prompt_injection": ("demo_prompt_injection",  "Prompt Injection Demo"),
            "input_pii":        ("demo_input_pii",         "Input PII Demo"),
        }

        if demo_type not in DEMO_CONFIG:
            return jsonify({"success": False, "error": f"Unknown demo_type: {demo_type}"}), 200

        config_key, trace_name = DEMO_CONFIG[demo_type]
        demos = config.get(config_key, [])

        if index >= len(demos):
            return jsonify({"success": False, "error": f"No {demo_type} demo at index {index}"}), 200

        demo     = demos[index]
        turns    = demo.get("turns", [])
        context_docs = demo.get("context", [])

        if not turns:
            return jsonify({"success": False, "error": "No turns in demo"}), 200

        def _log_in_background():
            try:
                context_text = "\n\n".join(context_docs)
                for turn in turns:
                    log_demo_trace(
                        question=turn["question"],
                        context=context_text,
                        wrong_answer=turn["answer"],
                        demo_type=demo_type,
                    )
                logger.info(f"[bg] Logged {demo_type}[{index}] demo to W&B Weave")
            except Exception as e:
                logger.error(f"[bg] Weave log error: {e}")

        threading.Thread(target=_log_in_background, daemon=True).start()

        return jsonify({"success": True, "turns": turns, "demo_type": demo_type}), 200

    except Exception as e:
        logger.error(f"Demo log error: {e}")
        return jsonify({"success": False, "error": str(e)}), 200


@app.route("/api/health", methods=["GET"])
def health():
    return jsonify({
        "status":  "ok",
        "mistral": mistral_client is not None,
        "weave":   WEAVE_ENABLED,
        "elevenlabs": bool(ELEVENLABS_API_KEY),
        "demos": {
            "hallucination":   len(config.get("demo_hallucinations", [])),
            "pii":             len(config.get("demo_pii_issues", [])),
            "prompt_injection":len(config.get("demo_prompt_injection", [])),
            "input_pii":       len(config.get("demo_input_pii", [])),
        },
    }), 200


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    print("=" * 60)
    print("SecureBank AI Backend")
    print(f"  LLM:        Mistral {'OK' if mistral_client else 'MISSING KEY'}")
    print(f"  Tracing:    W&B Weave {'OK' if WEAVE_ENABLED else 'MISSING KEY'}")
    print(f"  STT:        ElevenLabs {'OK' if ELEVENLABS_API_KEY else 'MISSING KEY'}")
    print(f"  Server:     http://localhost:5001")
    if WEAVE_ENABLED:
        print(f"  Traces:     https://wandb.ai/{RESOLVED_ENTITY}/{WANDB_PROJECT}/weave")
    print("=" * 60)
    app.run(host="0.0.0.0", port=5001, debug=True, use_reloader=False)
