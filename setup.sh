#!/bin/bash

# Ultracode V2 Setup Script
# This script helps new users get started quickly

set -e

echo "🤖 Ultracode V2 Setup"
echo "===================="
echo ""

# Check Node.js version
echo "📋 Checking prerequisites..."
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed. Please install Node.js 18.0.0 or higher."
    exit 1
fi

NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
    echo "❌ Node.js version must be 18.0.0 or higher. Current version: $(node -v)"
    exit 1
fi

echo "✅ Node.js $(node -v) detected"

# Create data directory if it doesn't exist
if [ ! -d "data" ]; then
    echo "📁 Creating data directory..."
    mkdir -p data
fi

# Copy config example if config doesn't exist
if [ ! -f "data/config.json" ]; then
    echo "📝 Creating config.json from example..."
    cp config.json.example data/config.json
    echo "⚠️  Please edit data/config.json and add your API keys"
    CONFIG_CREATED=true
else
    echo "✅ config.json already exists"
    CONFIG_CREATED=false
fi

# Install dependencies
echo "📦 Installing dependencies..."
npm install

echo ""
echo "✨ Setup complete!"
echo ""

if [ "$CONFIG_CREATED" = true ]; then
    echo "⚠️  IMPORTANT: Edit data/config.json and add your API keys:"
    echo "   - OpenAI API key (for GPT models)"
    echo "   - Anthropic API key (for Claude models)"
    echo "   - Google API key (for Gemini models)"
    echo "   - Tavily API key (for web search, optional)"
    echo ""
fi

echo "🚀 To start Ultracode:"
echo "   npm start"
echo ""
echo "   Then open http://localhost:4173 in your browser"
echo ""
echo "📚 For more information, see README.md"
