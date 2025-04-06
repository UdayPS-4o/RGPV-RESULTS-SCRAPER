import { RGPVScraper } from './lib/index.js';
import fs from 'fs';
import path from 'path';
import os from 'os';

// HARDCODED VALUES - Change these according to your needs
const PREFIX = '0818IT23';  // Roll number prefix
const START = '1001';       // Start roll number (last 4 digits)
const END = '1078';         // End roll number (last 4 digits)
const SEMESTER = '3';       // Semester to fetch
const CONCURRENCY = 50;     // Increased concurrency - now safe with our OCR queue

/**
 * Simple batch processor with hardcoded values
 */
async function main() {
  // Create a scraper instance with optimized settings
  const scraper = new RGPVScraper({ 
    debug: true,
    maxRetries: 10
  });
  
  try {
    // Ensure results directory exists
    const resultsDir = path.join(process.cwd(), 'results');
    if (!fs.existsSync(resultsDir)) {
      fs.mkdirSync(resultsDir, { recursive: true });
    }
    
    // Create roll number batch from range
    const studentBatch = [];
    for (let i = parseInt(START); i <= parseInt(END); i++) {
      const rollNumber = `${PREFIX}${i.toString().padStart(4, '0')}`;
      studentBatch.push({ rollNumber, semester: SEMESTER });
    }
    
    console.log(`Starting batch processing for ${studentBatch.length} students with concurrency ${CONCURRENCY}`);
    console.log(`Roll number range: ${PREFIX}${START.padStart(4, '0')} to ${PREFIX}${END.padStart(4, '0')}`);
    console.log(`System has ${os.cpus().length} CPU cores - using OCR queue with limited concurrency of 2`);
    
    const startTime = Date.now();
    
    // Process the batch with higher concurrency (safe now with OCR queue)
    const batchResults = await scraper.batchProcess(studentBatch, CONCURRENCY);
    
    const endTime = Date.now();
    const duration = (endTime - startTime) / 1000;
    
    
    // Print results summary
    console.log(`\nBatch processing complete in ${duration.toFixed(2)} seconds.`);
    console.log(`✅ Successful: ${summary.successfulResults}/${studentBatch.length}`);
    console.log(`❌ Failed: ${summary.failedResults}/${studentBatch.length}`);
    console.log(`⏱️ Average processing time: ${(duration / studentBatch.length).toFixed(2)} seconds per student`);
    
    // Print a table of the first 20 results
    const topResults = batchResults.slice(0, 20);
    
    if (topResults.length > 0) {
      console.log('\nSample Results:');
      console.log('-'.repeat(80));
      console.log('| Roll Number | Status | SGPA  | CGPA  | Name                       |');
      console.log('-'.repeat(80));
      
      topResults.forEach(result => {
        const rollNumber = result.rollNumber;
        const status = result.success ? '✅' : '❌';
        const sgpa = result.success ? result.data.results.sgpa : 'N/A';
        const cgpa = result.success ? result.data.results.cgpa : 'N/A';
        const name = result.success ? result.data.student.name.padEnd(25) : 'N/A'.padEnd(25);
        
        console.log(`| ${rollNumber} | ${status}     | ${sgpa.padEnd(5)} | ${cgpa.padEnd(5)} | ${name} |`);
      });
      
      console.log('-'.repeat(80));
    }
  } catch (error) {
    console.error('Error in batch processing:', error);
  } finally {
    // Always clean up resources, especially Tesseract workers
    try {
      await scraper.captchaSolver.cleanup();
      console.log("Cleaned up all OCR resources");
    } catch (cleanupError) {
      console.error("Error during cleanup:", cleanupError);
    }
  }
}

// Add graceful shutdown handlers
process.on('SIGINT', async () => {
  console.log('Received SIGINT. Shutting down gracefully...');
  try {
    // You would need to access the scraper here, which is not possible
    // This would require refactoring to make the scraper accessible from outside main()
    console.log('Cannot access scraper outside main() - consider refactoring if needed');
  } catch (e) {
    console.error('Error during emergency shutdown:', e);
  }
  process.exit(0);
});

// Run the main function
main(); 