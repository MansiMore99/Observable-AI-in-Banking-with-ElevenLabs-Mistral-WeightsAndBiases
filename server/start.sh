#!/bin/bash
# ============================================================
# SecureBank Galileo Logging Server - Startup Script
# ============================================================
# Creates/activates a Python venv and starts the Flask server.
# Usage:  cd "Bank Assistant/server" && bash start.sh
# ============================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
VENV_DIR="$SCRIPT_DIR/venv"

# Create venv if it doesn't exist
if [ ! -d "$VENV_DIR" ]; then
  echo "🐍 Creating virtual environment..."
  python3 -m venv "$VENV_DIR"
fi

# Activate venv
echo "🔧 Activating virtual environment..."
source "$VENV_DIR/bin/activate"

PYTHON="$VENV_DIR/bin/python3"
PIP="$VENV_DIR/bin/pip"

# Install dependencies
echo "📦 Installing dependencies..."
"$PIP" install -q -r "$SCRIPT_DIR/requirements.txt"

# Load .env from project root
ENV_FILE="$SCRIPT_DIR/../.env"
if [ -f "$ENV_FILE" ]; then
  echo "Loading .env..."
  set -o allexport
  source "$ENV_FILE"
  set +o allexport
fi

# Start the server
echo ""
"$PYTHON" "$SCRIPT_DIR/app.py"
