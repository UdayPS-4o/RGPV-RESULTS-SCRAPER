import fetch from 'node-fetch';
import { createWorker } from 'tesseract.js';
import fs from 'fs';
import path from 'path';
import pLimit from 'p-limit';
import os from 'os';
import crypto from 'crypto';

/**
 * Class responsible for solving CAPTCHA challenges
 */
class CaptchaSolver {
  constructor(debug = false) {
    this.debug = debug;
    // Create a dedicated OCR queue with limited concurrency
    this.ocrQueue = pLimit(2); // Limit to 2 concurrent OCR operations
    this.workerPool = [];
    this.isPoolInitialized = false;
    
    // Add statistics tracking
    this.stats = {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      averageTime: 0,
      totalTime: 0
    };
    
    // Create temp directory for captcha images
    this.tempDir = path.join(process.cwd(), 'temp_captchas');
    if (!fs.existsSync(this.tempDir)) {
      fs.mkdirSync(this.tempDir, { recursive: true });
    }
    
    // Track temp files for cleanup
    this.tempFiles = [];
  }

  /**
   * Initialize worker pool for parallel OCR processing
   * @returns {Promise<void>}
   */
  async initWorkerPool(poolSize = 2) {
    if (this.isPoolInitialized) return;
    
    if (this.debug) console.log(`Initializing Tesseract worker pool with ${poolSize} workers...`);
    
    // Create and initialize workers
    for (let i = 0; i < poolSize; i++) {
      try {
        if (this.debug) console.log(`Initializing worker ${i+1}/${poolSize}...`);
        const worker = await createWorker();
        
        // Additional error handling for worker initialization
        try {
          await worker.loadLanguage('eng');
          await worker.initialize('eng');
          
          // Set options for better accuracy with captchas
          await worker.setParameters({
            tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
            preserve_interword_spaces: '0',
            tessedit_pageseg_mode: '8', // Treat the image as a single word
          });
          
          this.workerPool.push({ worker, busy: false });
          if (this.debug) console.log(`Worker ${i+1} initialized successfully`);
        } catch (initError) {
          console.error(`Error initializing worker ${i+1}:`, initError);
          // Try to terminate the worker if initialization failed
          try {
            await worker.terminate();
          } catch (termError) {
            // Ignore termination errors
          }
          
          // Retry this worker
          i--;
          
          // Wait a bit before retrying
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      } catch (error) {
        console.error(`Error creating worker ${i+1}:`, error);
        // If we can't create even a single worker after multiple attempts, something is seriously wrong
        if (this.workerPool.length === 0 && i >= 3) {
          throw new Error('Failed to initialize any Tesseract workers after multiple attempts');
        }
      }
    }
    
    if (this.workerPool.length === 0) {
      throw new Error('Failed to initialize any Tesseract workers');
    }
    
    this.isPoolInitialized = true;
    if (this.debug) console.log(`Worker pool initialization complete with ${this.workerPool.length} workers`);
  }

  /**
   * Get an available worker from the pool
   * @returns {Promise<Object>} - An available worker
   */
  async getAvailableWorker() {
    if (!this.isPoolInitialized) {
      await this.initWorkerPool();
    }
    
    // Find an available worker
    const availableWorker = this.workerPool.find(w => !w.busy);
    
    if (availableWorker) {
      availableWorker.busy = true;
      return availableWorker;
    }
    
    // If all workers are busy, wait for one to become available
    return new Promise(resolve => {
      const checkInterval = setInterval(() => {
        const worker = this.workerPool.find(w => !w.busy);
        if (worker) {
          clearInterval(checkInterval);
          worker.busy = true;
          resolve(worker);
        }
      }, 100);
    });
  }

  /**
   * Release a worker back to the pool
   * @param {Object} workerObj - The worker object to release
   */
  releaseWorker(workerObj) {
    const worker = this.workerPool.find(w => w.worker === workerObj.worker);
    if (worker) {
      worker.busy = false;
    }
  }

  /**
   * Download the CAPTCHA image
   * @param {string} captchaUrl - The URL of the CAPTCHA image
   * @returns {Promise<Object>} - Object containing image buffer and file path
   */
  async downloadCaptcha(captchaUrl) {
    const fullUrl = `https://result.rgpv.ac.in/Result/${captchaUrl}`;
    if (this.debug) console.log(`Downloading captcha from: ${fullUrl}`);
    
    const response = await fetch(fullUrl);
    const buffer = await response.arrayBuffer();
    const imageBuffer = Buffer.from(buffer);
    
    if (this.debug) console.log(`Captcha image downloaded (${imageBuffer.length} bytes)`);
    
    // Generate a unique file name
    const timestamp = new Date().getTime();
    const random = crypto.randomBytes(4).toString('hex');
    const fileName = `captcha_${timestamp}_${random}.png`;
    const filePath = path.join(this.tempDir, fileName);
    
    // Save image to temp file
    fs.writeFileSync(filePath, imageBuffer);
    this.tempFiles.push(filePath);
    
    // Save a copy for debugging if needed
    if (this.debug) {
      const debugDir = path.join(process.cwd(), 'db');
      if (!fs.existsSync(debugDir)) {
        fs.mkdirSync(debugDir, { recursive: true });
      }
      fs.writeFileSync(path.join(debugDir, fileName), imageBuffer);
      console.log(`Captcha image saved to db/${fileName}`);
    }
    
    return { buffer: imageBuffer, path: filePath };
  }

  /**
   * Validate image file
   * @param {string} filePath - Path to the image file
   * @returns {boolean} - Whether the image is valid
   */
  validateImageFile(filePath) {
    try {
      // Check if file exists
      if (!fs.existsSync(filePath)) {
        return false;
      }
      
      // Check file size (must be at least 100 bytes)
      const stats = fs.statSync(filePath);
      if (stats.size < 100) {
        return false;
      }
      
      // Check file extension
      const ext = path.extname(filePath).toLowerCase();
      if (ext !== '.png' && ext !== '.jpg' && ext !== '.jpeg' && ext !== '.gif') {
        return false;
      }
      
      // Check file header magic number
      const buffer = Buffer.alloc(8);
      const fd = fs.openSync(filePath, 'r');
      fs.readSync(fd, buffer, 0, 8, 0);
      fs.closeSync(fd);
      
      // PNG magic number: 89 50 4E 47 0D 0A 1A 0A
      const isPNG = buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47;
      // JPEG magic number: FF D8
      const isJPEG = buffer[0] === 0xFF && buffer[1] === 0xD8;
      // GIF magic number: 47 49 46 38
      const isGIF = buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x38;
      
      return isPNG || isJPEG || isGIF;
    } catch (error) {
      console.error('Error validating image file:', error);
      return false;
    }
  }

  /**
   * Solve a single CAPTCHA image using Tesseract OCR
   * @param {Object} imageData - Object containing image buffer and file path
   * @returns {Promise<string>} - The solved CAPTCHA text
   */
  async solveCaptcha(imageData) {
    if (!imageData || (!imageData.buffer && !imageData.path)) {
      console.error('Invalid image data provided');
      return '';
    }
    
    // Queue this OCR operation to prevent concurrency issues
    return this.ocrQueue(async () => {
      if (this.debug) console.log('Starting Tesseract OCR to solve captcha...');
      
      // Get an available worker from the pool
      const workerObj = await this.getAvailableWorker();
      const startTime = Date.now();
      this.stats.totalRequests++;
      
      try {
        // Validate image
        if (!this.validateImageFile(imageData.path)) {
          throw new Error('Invalid image file detected');
        }
        
        // Recognize text from file path instead of buffer to avoid format issues
        if (this.debug) console.log(`Processing captcha from file: ${imageData.path}`);
        
        // Additional error handling for OCR recognition
        let data;
        try {
          const result = await workerObj.worker.recognize(imageData.path);
          data = result.data;
        } catch (recognizeError) {
          // Try one more time with a file-based approach
          console.error('First OCR attempt failed, trying alternative approach:', recognizeError.message);
          
          // Try recognizing again with a short delay
          await new Promise(resolve => setTimeout(resolve, 1000));
          
          // Use different approach for the retry
          if (imageData.buffer && imageData.buffer.length > 100) {
            // Write to a new file with a different name
            const retryFileName = `retry_${Date.now()}_${path.basename(imageData.path)}`;
            const retryPath = path.join(this.tempDir, retryFileName);
            fs.writeFileSync(retryPath, imageData.buffer);
            this.tempFiles.push(retryPath);
            
            // Try the recognition again with the new file
            const retryResult = await workerObj.worker.recognize(retryPath);
            data = retryResult.data;
          } else {
            throw new Error('Cannot retry OCR - invalid buffer');
          }
        }
        
        if (this.debug) console.log('OCR result:', data.text);
        
        // Clean up the result - remove spaces and non-alphanumeric chars
        const captchaText = data.text.replace(/[^A-Z0-9]/g, '').trim();
        if (this.debug) console.log('Cleaned captcha text:', captchaText);
        
        // Update success stats
        this.stats.successfulRequests++;
        
        return captchaText;
      } catch (error) {
        console.error('Error in OCR processing:', error.message || String(error));
        // Update failure stats
        this.stats.failedRequests++;
        // Return empty string on error, will be filtered out in solveMultipleCaptchas
        return '';
      } finally {
        // Update timing stats
        const processingTime = Date.now() - startTime;
        this.stats.totalTime += processingTime;
        this.stats.averageTime = this.stats.totalTime / this.stats.totalRequests;
        
        if (this.debug) {
          console.log(`OCR processing took ${processingTime}ms (avg: ${this.stats.averageTime.toFixed(0)}ms)`);
          console.log(`OCR stats: ${this.stats.successfulRequests}/${this.stats.totalRequests} successful (${this.stats.failedRequests} failed)`);
        }
        
        // Release the worker back to the pool
        this.releaseWorker(workerObj);
      }
    });
  }

  /**
   * Solve multiple CAPTCHAs and return the most common result
   * @param {string} captchaUrl - The URL of the CAPTCHA image
   * @param {number} count - Maximum number of CAPTCHA attempts
   * @param {number} earlyMatchCount - Stop when any result appears this many times
   * @returns {Promise<string>} - The most likely CAPTCHA solution
   */
  async solveMultipleCaptchas(captchaUrl, count = 7, earlyMatchCount = 3) {
    if (this.debug) console.log(`Attempting to solve captchas (max ${count}, early stop at ${earlyMatchCount} matches)...`);
    
    const results = [];
    const counts = {};
    let mostCommonResult = '';
    let maxCount = 0;
    
    // Download and solve multiple captchas
    for (let i = 0; i < count; i++) {
      try {
        if (this.debug) console.log(`Attempt ${i+1}/${count}`);
        
        // Add a small delay between requests to avoid rate limiting
        if (i > 0) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
        
        let imageData;
        try {
          imageData = await this.downloadCaptcha(captchaUrl);
        } catch (error) {
          console.error(`Error downloading captcha in attempt ${i+1}:`, error.message);
          continue; // Skip this attempt and try again
        }
        
        const result = await this.solveCaptcha(imageData);
        if (result && result.length >= 4 && result.length <= 6) {
          // Only accept results that are likely to be valid captchas (4-6 chars)
          results.push(result);
          
          // Count occurrences and check for early match
          counts[result] = (counts[result] || 0) + 1;
          
          if (counts[result] > maxCount) {
            maxCount = counts[result];
            mostCommonResult = result;
            
            // Early stopping if we have enough matches
            if (maxCount >= earlyMatchCount) {
              if (this.debug) console.log(`Early match found! '${mostCommonResult}' appeared ${maxCount} times after ${i+1} attempts`);
              break;
            }
          }
        }
      } catch (error) {
        console.error(`Error in attempt ${i+1}:`, error);
      }
    }
    
    if (this.debug) {
      console.log('All captcha results:', results);
      console.log(`Most common result: ${mostCommonResult} (appeared ${maxCount} times)`);
    }
    
    return mostCommonResult;
  }

  /**
   * Process a CAPTCHA from the scraped data
   * @param {Object} formData - The form data including CAPTCHA image URL
   * @returns {Promise<Object>} - The CAPTCHA solution and form data
   */
  async processCaptcha(formData) {
    try {
      if (!formData) {
        throw new Error("No form data provided");
      }
      
      // Ensure worker pool is initialized
      if (!this.isPoolInitialized) {
        await this.initWorkerPool();
      }
      
      // Solve multiple captchas and get the most common result
      const captchaText = await this.solveMultipleCaptchas(formData.captchaImage);
      
      if (!captchaText) {
        throw new Error("Failed to solve CAPTCHA");
      }
      
      return {
        captchaText,
        jsonData: formData
      };
    } catch (error) {
      console.error('Error in processing captcha:', error);
      return null;
    }
  }
  
  /**
   * Set debug mode
   * @param {boolean} debug Whether to enable debug mode
   */
  setDebug(debug) {
    this.debug = debug;
  }
  
  /**
   * Clean up resources when done
   */
  async cleanup() {
    if (this.debug) console.log('Cleaning up Tesseract workers and temporary files...');
    
    // Terminate all workers in the pool
    for (const { worker } of this.workerPool) {
      try {
        await worker.terminate();
      } catch (error) {
        console.error('Error terminating worker:', error);
      }
    }
    
    this.workerPool = [];
    this.isPoolInitialized = false;
    
    // Clean up temporary files
    this.cleanupTempFiles();
    
    if (this.debug) console.log('All workers terminated and temp files cleaned up');
  }
  
  /**
   * Clean up temporary captcha image files
   */
  cleanupTempFiles() {
    if (this.debug) console.log(`Cleaning up ${this.tempFiles.length} temporary captcha files`);
    
    let deletedCount = 0;
    for (const filePath of this.tempFiles) {
      try {
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
          deletedCount++;
        }
      } catch (error) {
        console.error(`Error deleting temp file ${filePath}:`, error.message);
      }
    }
    
    // Clear the temp files array
    this.tempFiles = [];
    
    if (this.debug) console.log(`Deleted ${deletedCount} temporary files`);
    
    // Try to remove the temp directory if empty
    try {
      const files = fs.readdirSync(this.tempDir);
      if (files.length === 0) {
        fs.rmdirSync(this.tempDir);
        if (this.debug) console.log(`Removed empty temp directory: ${this.tempDir}`);
      }
    } catch (error) {
      console.error(`Error removing temp directory: ${this.tempDir}:`, error.message);
    }
  }

  /**
   * Get OCR statistics
   * @returns {Object} - Statistics about OCR operations
   */
  getStats() {
    return {
      ...this.stats,
      averageTime: `${this.stats.averageTime.toFixed(0)}ms`,
      successRate: `${((this.stats.successfulRequests / this.stats.totalRequests) * 100).toFixed(1)}%`,
      workers: this.workerPool.length,
      queueConcurrency: this.ocrQueue.concurrency
    };
  }
}

export default CaptchaSolver; 