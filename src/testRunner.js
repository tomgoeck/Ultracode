// src/testRunner.js
// Screenshot-based automated testing with LLM verification

const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

class TestRunner {
  constructor(llmRegistry) {
    this.llmRegistry = llmRegistry;
    this.browser = null;
  }

  /**
   * Initialize Puppeteer browser
   */
  async init() {
    if (!this.browser) {
      console.log('[TestRunner] Launching Puppeteer browser...');
      this.browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
      });
      console.log('[TestRunner] Browser ready');
    }
  }

  /**
   * Close browser
   */
  async close() {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      console.log('[TestRunner] Browser closed');
    }
  }

  /**
   * Test a feature by capturing screenshot and verifying with LLM
   * @param {Object} options
   * @param {string} options.url - URL to test
   * @param {string} options.featureName - Feature name
   * @param {string} options.featureDescription - Feature description
   * @param {string} options.dod - Definition of Done criteria
   * @param {string} options.voteModel - LLM model to use for verification
   * @param {string} options.screenshotPath - Where to save screenshot
   * @returns {Promise<{passed: boolean, feedback: string, screenshotPath: string}>}
   */
  async testFeature({ url, featureName, featureDescription, dod, voteModel, screenshotPath }) {
    await this.init();

    console.log(`[TestRunner] Testing feature: ${featureName}`);
    console.log(`[TestRunner] URL: ${url}`);

    try {
      // Capture screenshot
      const screenshot = await this.captureScreenshot(url, screenshotPath);

      // Verify with LLM
      const result = await this.verifyWithLLM({
        screenshotPath: screenshot,
        featureName,
        featureDescription,
        dod,
        voteModel
      });

      console.log(`[TestRunner] Test result: ${result.passed ? 'PASS' : 'FAIL'}`);
      return result;

    } catch (error) {
      console.error(`[TestRunner] Test failed:`, error.message);
      return {
        passed: false,
        feedback: `Test execution failed: ${error.message}`,
        screenshotPath: null
      };
    }
  }

  /**
   * Capture screenshot of URL
   * @param {string} url
   * @param {string} outputPath
   * @returns {Promise<string>} Path to screenshot
   */
  async captureScreenshot(url, outputPath) {
    await this.init();

    console.log(`[TestRunner] Capturing screenshot: ${url}`);

    const page = await this.browser.newPage();

    try {
      await page.setViewport({ width: 1920, height: 1080 });

      // Navigate with timeout
      await page.goto(url, {
        waitUntil: 'networkidle2',
        timeout: 30000
      });

      // Wait a bit for any animations/JS to settle
      await page.waitForTimeout(1000);

      // Take screenshot
      await page.screenshot({
        path: outputPath,
        fullPage: true
      });

      console.log(`[TestRunner] Screenshot saved: ${outputPath}`);
      return outputPath;

    } finally {
      await page.close();
    }
  }

  /**
   * Verify screenshot against DoD using LLM vision
   * @param {Object} options
   * @returns {Promise<{passed: boolean, feedback: string, screenshotPath: string}>}
   */
  async verifyWithLLM({ screenshotPath, featureName, featureDescription, dod, voteModel }) {
    console.log(`[TestRunner] Verifying with LLM: ${voteModel}`);

    // Read screenshot as base64
    const imageBuffer = fs.readFileSync(screenshotPath);
    const base64Image = imageBuffer.toString('base64');

    // Build verification prompt
    const prompt = this._buildVerificationPrompt(featureName, featureDescription, dod);

    try {
      // Get LLM provider
      const provider = this.llmRegistry.get(voteModel);
      if (!provider) {
        throw new Error(`Provider not found: ${voteModel}`);
      }

      // Check if provider supports vision
      const supportsVision = this._providerSupportsVision(voteModel);

      let response;
      if (supportsVision) {
        // Send image + prompt for vision models
        response = await provider.generateWithImage(prompt, base64Image);
      } else {
        // Fallback: just use text prompt (less accurate)
        console.warn(`[TestRunner] Model ${voteModel} doesn't support vision, using text-only verification`);
        response = await provider.generate(prompt + '\n\n[Note: Screenshot verification not available for this model]');
      }

      // Parse response
      const result = this._parseVerificationResponse(response);

      return {
        passed: result.passed,
        feedback: result.feedback,
        screenshotPath
      };

    } catch (error) {
      console.error(`[TestRunner] LLM verification failed:`, error.message);
      return {
        passed: false,
        feedback: `Verification error: ${error.message}`,
        screenshotPath
      };
    }
  }

  /**
   * Build verification prompt
   */
  _buildVerificationPrompt(featureName, featureDescription, dod) {
    return `You are a QA engineer testing a web application feature.

**Feature Name:** ${featureName}

**Feature Description:**
${featureDescription}

**Definition of Done (DoD):**
${dod}

**Your Task:**
Analyze the screenshot of the application and verify if the feature meets ALL criteria in the Definition of Done.

**Response Format:**
Respond with a JSON object:
{
  "passed": true/false,
  "feedback": "Detailed explanation of what passed/failed"
}

**Rules:**
- Only mark as "passed": true if ALL DoD criteria are met
- Be specific in feedback about what works and what doesn't
- Check both visual elements and functionality evidence
- If any DoD criterion is not visible or not met, mark as failed

Respond with JSON only, no additional text.`;
  }

  /**
   * Parse LLM verification response
   */
  _parseVerificationResponse(response) {
    try {
      // Try to extract JSON from response
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('No JSON found in response');
      }

      const parsed = JSON.parse(jsonMatch[0]);

      return {
        passed: parsed.passed === true,
        feedback: parsed.feedback || 'No feedback provided'
      };

    } catch (error) {
      console.error('[TestRunner] Failed to parse verification response:', error.message);

      // Fallback: analyze text for pass/fail indicators
      const lowerResponse = response.toLowerCase();
      const hasPassed = lowerResponse.includes('passed') || lowerResponse.includes('pass');
      const hasFailed = lowerResponse.includes('failed') || lowerResponse.includes('fail');

      if (hasPassed && !hasFailed) {
        return { passed: true, feedback: response };
      }

      return { passed: false, feedback: response };
    }
  }

  /**
   * Check if provider supports vision/images
   */
  _providerSupportsVision(modelName) {
    const visionModels = [
      'gpt-4-vision',
      'gpt-4o',
      'gpt-4o-mini',
      'claude-3',
      'claude-3.5',
      'gemini-1.5',
      'gemini-2.0'
    ];

    return visionModels.some(vm => modelName.toLowerCase().includes(vm));
  }

  /**
   * Run manual checks for DoD items marked as "manual"
   * Returns instructions for user
   */
  generateManualTestInstructions(feature) {
    const manualChecks = [];

    if (feature.dod) {
      try {
        const dodArray = typeof feature.dod === 'string' ? JSON.parse(feature.dod) : feature.dod;

        dodArray.forEach((item, idx) => {
          if (item.type === 'manual') {
            manualChecks.push({
              index: idx + 1,
              description: item.description
            });
          }
        });
      } catch (err) {
        console.error('[TestRunner] Failed to parse DoD:', err.message);
      }
    }

    if (manualChecks.length === 0) {
      return null;
    }

    return {
      featureId: feature.id,
      featureName: feature.name,
      checks: manualChecks,
      instructions: `Please manually verify the following:\n${manualChecks.map(c => `${c.index}. ${c.description}`).join('\n')}`
    };
  }
}

module.exports = { TestRunner };
