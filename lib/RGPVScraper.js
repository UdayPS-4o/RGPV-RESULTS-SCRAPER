import FormFetcher from './FormFetcher.js';
import CaptchaSolver from './CaptchaSolver.js';
import ResultSubmitter from './ResultSubmitter.js';
import pLimit from 'p-limit';
import fs from 'fs';
import path from 'path';

/**
 * Main RGPV Result Scraper class that coordinates the entire process
 */
class RGPVScraper {
  /**
   * Create a new RGPV Scraper instance
   * @param {Object} options - Configuration options
   * @param {boolean} options.debug - Enable debug mode
   * @param {number} options.maxRetries - Maximum retry attempts
   */
  constructor(options = {}) {
    this.debug = options.debug || false;
    this.maxRetries = options.maxRetries || 3;
    
    // Initialize components
    this.formFetcher = new FormFetcher(this.debug);
    this.captchaSolver = new CaptchaSolver(this.debug);
    this.resultSubmitter = new ResultSubmitter(this.debug);
    
    // Initialize blacklist from existing results
    this.blacklist = [];
    this.loadBlacklist();
  }
  
  /**
   * Load blacklist from existing results
   */
  loadBlacklist() {
    const resultsDir = path.join(process.cwd(), 'results');
    if (fs.existsSync(resultsDir)) {
      fs.readdirSync(resultsDir).forEach(file => {
        if (file.endsWith('.json') && !file.startsWith('batch_') && !file.startsWith('range_')) {
          this.blacklist.push(file.split('.')[0]);
        }
      });
    }
    if (this.debug && this.blacklist.length > 0) {
      console.log(`Loaded blacklist with ${this.blacklist.length} already processed roll numbers`);
    }
  }

  /**
   * Set debug mode for all components
   * @param {boolean} debug - Whether to enable debug mode
   */
  setDebug(debug) {
    this.debug = debug;
    this.formFetcher.setDebug(debug);
    this.captchaSolver.setDebug(debug);
    this.resultSubmitter.setDebug(debug);
  }

  /**
   * Set maximum number of retry attempts
   * @param {number} maxRetries - Maximum number of retry attempts
   */
  setMaxRetries(maxRetries) {
    this.maxRetries = maxRetries;
  }

  /**
   * Get a student's result
   * @param {string} rollNumber - The student's roll number
   * @param {string} semester - The semester number
   * @returns {Promise<Object>} - The result data or error information
   */
  async getResult(rollNumber, semester) {
    // Check if result already exists
    if (this.blacklist.includes(rollNumber)) {
      if (this.debug) console.log(`Skipping ${rollNumber} - result already exists`);
      return {
        success: true,
        rollNumber,
        semester,
        data: JSON.parse(fs.readFileSync(path.join(process.cwd(), 'results', `${rollNumber}.json`), 'utf8')),
        message: 'Result loaded from cache'
      };
    }
    
    if (this.debug) console.log(`Starting RGPV result scraping for roll number: ${rollNumber}, semester: ${semester}`);
    
    let success = false;
    let resultData = null;
    let errors = [];
    let siteErrors = [];
    
    // Try multiple times if needed
    for (let attempt = 1; attempt <= this.maxRetries && !success; attempt++) {
      if (this.debug) console.log(`\n======== ATTEMPT ${attempt}/${this.maxRetries} ========`);
      
      try {
        // Step 1: Fetch initial data and get form with captcha
        if (this.debug) console.log("\n======== STEP 1: FETCHING INITIAL DATA ========");
        const scrapedData = await this.formFetcher.fetchInitialData();
        
        if (!scrapedData) {
          const error = "Failed to fetch initial data";
          errors.push({ attempt, step: 1, error });
          if (this.debug) console.error(error + ". Retrying...");
          continue;
        }
        
        // Step 2: Process and solve the captcha
        if (this.debug) console.log("\n======== STEP 2: SOLVING CAPTCHA ========");
        const captchaResult = await this.captchaSolver.processCaptcha(scrapedData);
        
        if (!captchaResult) {
          const error = "Failed to solve CAPTCHA";
          errors.push({ attempt, step: 2, error });
          if (this.debug) console.error(error + ". Retrying...");
          continue;
        }
        
        // Step 3: Submit the form with the solved captcha
        if (this.debug) console.log("\n======== STEP 3: SUBMITTING FORM ========");
        const submissionResult = await this.resultSubmitter.submitFormWithCaptcha(rollNumber, semester, captchaResult);
        
        // Check for different return types
        if (!submissionResult || submissionResult.success === false) {
          const error = submissionResult?.error || "Failed to submit form or invalid response";
          errors.push({ attempt, step: 3, error });
          
          // If it's a site maintenance issue, no need to retry
          if (submissionResult?.error?.includes("maintenance")) {
            siteErrors.push({ attempt, error: submissionResult.error });
            if (this.debug) console.log("Site is under maintenance, stopping attempts.");
            break;
          }
          
          if (this.debug) console.log(`Attempt ${attempt} failed: ${error}, ${attempt < this.maxRetries ? "trying again..." : "all attempts exhausted."}`);
          continue;
        } else if (submissionResult.success) {
          success = true;
          resultData = submissionResult.data;
          
          // Add to blacklist once successful
          if (!this.blacklist.includes(rollNumber)) {
            this.blacklist.push(rollNumber);
          }
          
          if (this.debug) console.log("SUCCESS: Successfully fetched and saved the result!");
        }
      } catch (error) {
        const errorMsg = error.message || String(error);
        errors.push({ attempt, error: errorMsg });
        if (this.debug) console.error(`Error in attempt ${attempt}:`, error);
      }
    }
    
    // Return the final result
    return {
      success,
      rollNumber,
      semester,
      data: resultData,
      attempts: errors.length,
      errors: errors.length > 0 ? errors : undefined,
      siteErrors: siteErrors.length > 0 ? siteErrors : undefined
    };
  }
  
  /**
   * Batch process multiple roll numbers
   * @param {Array<Object>} students - Array of student objects with rollNumber and semester
   * @param {number} concurrency - Number of concurrent requests
   * @param {Function} progressCallback - Optional callback function called after each result
   * @returns {Promise<Array<Object>>} - Array of results
   */
  async batchProcess(students, concurrency = 1, progressCallback = null) {
    if (!Array.isArray(students) || students.length === 0) {
      throw new Error("No students provided for batch processing");
    }
    
    // Filter out students that are in the blacklist if requested
    const filteredStudents = students.filter(student => 
      !this.blacklist.includes(student.rollNumber) || student.forceReprocess === true
    );
    
    if (filteredStudents.length < students.length && this.debug) {
      console.log(`Filtered out ${students.length - filteredStudents.length} students that were already processed`);
    }
    
    if (filteredStudents.length === 0) {
      console.log("All students have already been processed");
      return [];
    }
    
    if (this.debug) console.log(`Starting batch processing for ${filteredStudents.length} students with concurrency ${concurrency}`);
    
    // Initialize the Tesseract worker pool before starting parallel processing
    await this.captchaSolver.initWorkerPool(2);
    
    // Create a concurrency limit
    const limit = pLimit(concurrency);
    const results = [];
    let completedCount = 0;
    const totalCount = filteredStudents.length;
    
    // Initialize retries tracking
    const retries = {};
    
    try {
      // Create an array of promises for each student
      const promises = filteredStudents.map((student, index) => {
        return limit(async () => {
          if (this.debug) console.log(`Processing student ${index + 1}/${totalCount}: ${student.rollNumber}`);
          
          // Initialize retry counter if not exists
          if (!retries[student.rollNumber]) {
            retries[student.rollNumber] = 0;
          }
          
          try {
            const result = await this.getResult(student.rollNumber, student.semester);
            completedCount++;
            
            if (this.debug) {
              const successRate = Math.round((results.filter(r => r.success).length / completedCount) * 100);
              if (result.success) {
                console.log(`✅ Success: ${student.rollNumber} (${completedCount}/${totalCount}, success rate: ${successRate}%)`);
              } else {
                console.log(`❌ Failed: ${student.rollNumber} (${completedCount}/${totalCount}, success rate: ${successRate}%)`);
              }
            }
            
            results.push(result);
            
            // Call progress callback if provided
            if (typeof progressCallback === 'function') {
              progressCallback(result);
            }
            
            // Save progress periodically
            if (completedCount % 5 === 0 || completedCount === totalCount) {
              // this.saveBatchResults(results, `progress_batch_${new Date().toISOString().replace(/:/g, '-')}`);
            }
            
            return result;
          } catch (error) {
            console.error(`Error processing student ${student.rollNumber}:`, error);
            completedCount++;
            
            // Increment retry counter but limit to maxRetries
            retries[student.rollNumber]++;
            
            // Check if we should retry
            if (retries[student.rollNumber] < this.maxRetries) {
              console.log(`Retrying ${student.rollNumber} (attempt ${retries[student.rollNumber] + 1}/${this.maxRetries})`);
              filteredStudents.push(student); // Add back to the queue for retry
            } else {
              // Max retries reached, add to results with failure
              const failedResult = {
                success: false,
                rollNumber: student.rollNumber,
                semester: student.semester,
                error: error.message || String(error)
              };
              results.push(failedResult);
              
              // Call progress callback if provided
              if (typeof progressCallback === 'function') {
                progressCallback(failedResult);
              }
            }
          }
        });
      });
      
      // Execute all promises
      await Promise.all(promises);
      
      return results;
    } catch (error) {
      console.error('Error in batch processing:', error);
      throw error;
    } finally {
      // Clean up resources
      await this.captchaSolver.cleanup();
    }
  }
  
  /**
   * Save batch results to a file
   * @param {Array<Object>} results - Array of result objects
   * @param {string} filename - Filename to save as (without extension)
   */
  saveBatchResults(results, filename) {
    const resultsDir = path.join(process.cwd(), 'results');
    if (!fs.existsSync(resultsDir)) {
      fs.mkdirSync(resultsDir, { recursive: true });
    }
    
    const batchResultsFile = path.join(resultsDir, `${filename}.json`);
    fs.writeFileSync(batchResultsFile, JSON.stringify(results, null, 2));
    
    if (this.debug) {
      console.log(`Batch results saved to ${batchResultsFile}`);
    }
  }
}

export default RGPVScraper; 