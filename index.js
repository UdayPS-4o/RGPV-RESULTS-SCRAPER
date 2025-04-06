import { RGPVScraper } from './lib/index.js';
import fs from 'fs';
import path from 'path';
import os from 'os';

// Default configuration
const DEFAULT_CONFIG = {
  prefix: '0818CS23',    // Roll number prefix
  start: '1001',         // Start roll number (last 4 digits)
  end: '1234',           // End roll number (last 4 digits)
  semester: '3',         // Semester to fetch
  concurrency: 12,       // Default concurrency (now safe with OCR queue)
  ocrConcurrency: 2,     // Number of OCR workers
  debug: true,           // Debug mode
  mode: 'batch'          // Default to batch mode
};

// Parse command line arguments
function parseArgs() {
  const args = process.argv.slice(2);
  const config = { ...DEFAULT_CONFIG };
  
  // Support for simple mode selection
  if (args.includes('--single')) {
    config.mode = 'single';
    // In single mode, start and end are the same
    // We'll extract them later if specified
  }
  
  if (args.includes('--batch')) {
    config.mode = 'batch';
  }
  
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    
    if (arg === '--concurrency' && i + 1 < args.length) {
      const value = parseInt(args[++i]);
      if (!isNaN(value) && value > 0) {
        config.concurrency = value;
      }
    } else if (arg === '--ocr-concurrency' && i + 1 < args.length) {
      const value = parseInt(args[++i]);
      if (!isNaN(value) && value > 0) {
        config.ocrConcurrency = value;
      }
    } else if (arg === '--prefix' && i + 1 < args.length) {
      config.prefix = args[++i];
    } else if (arg === '--start' && i + 1 < args.length) {
      config.start = args[++i];
    } else if (arg === '--end' && i + 1 < args.length) {
      config.end = args[++i];
    } else if (arg === '--rollno' && i + 1 < args.length) {
      // Support for single roll number processing
      const rollNo = args[++i];
      
      // Check if the roll number follows the expected pattern
      const match = rollNo.match(/^(.+?)(\d{4})$/);
      if (match) {
        config.prefix = match[1];
        config.start = match[2];
        config.end = match[2]; // same as start for single mode
        config.mode = 'single';
      } else {
        console.error(`Invalid roll number format: ${rollNo}`);
        console.error('Expected format: [prefix][4-digit-number], e.g., 0818CS231001');
        process.exit(1);
      }
    } else if (arg === '--semester' && i + 1 < args.length) {
      config.semester = args[++i];
    } else if (arg === '--debug') {
      config.debug = true;
    } else if (arg === '--no-debug') {
      config.debug = false;
    } else if (arg === '--help') {
      printHelp();
      process.exit(0);
    }
  }
  
  // In single mode, ensure start and end are the same
  if (config.mode === 'single') {
    config.end = config.start;
  }
  
  return config;
}

// Print help message
function printHelp() {
  console.log(`
RGPV Result Scraper

Usage: node index.js [options]

Modes:
  --single                    Process a single student (default when --rollno is used)
  --batch                     Process a batch of students (default)

Options:
  --rollno <string>           Full roll number for single processing (e.g., 0818CS231001)
  --prefix <string>           Roll number prefix (default: ${DEFAULT_CONFIG.prefix})
  --start <string>            Start roll number (default: ${DEFAULT_CONFIG.start})
  --end <string>              End roll number (default: ${DEFAULT_CONFIG.end})
  --semester <string>         Semester (default: ${DEFAULT_CONFIG.semester})
  --concurrency <number>      Number of parallel requests (default: ${DEFAULT_CONFIG.concurrency})
  --ocr-concurrency <number>  Number of OCR workers (default: ${DEFAULT_CONFIG.ocrConcurrency})
  --debug                     Enable debug mode (default: ${DEFAULT_CONFIG.debug})
  --no-debug                  Disable debug mode
  --help                      Show this help message

Examples:
  node index.js --single --rollno 0818CS231001 --semester 3
  node index.js --batch --prefix 0818CS23 --start 1001 --end 1234 --semester 4
  node index.js --prefix 0818CS23 --start 1001 --end 1234
  `);
}

// Read configuration
const config = parseArgs();
const { prefix, start, end, semester, concurrency, ocrConcurrency, debug, mode } = config;

// Create a scraper instance that's globally accessible
export const scraper = new RGPVScraper({ 
  debug: debug,
  maxRetries: 3
});

/**
 * Print a periodic status report
 * @param {Array} results - Current results
 * @param {number} startTime - Start time in milliseconds
 * @param {number} totalCount - Total number of students
 */
function printStatusReport(results, startTime, totalCount) {
  const completedCount = results.length;
  if (completedCount === 0) return; // Skip if no results yet
  
  const successCount = results.filter(r => r.success).length;
  const currentTime = Date.now();
  const elapsedSeconds = (currentTime - startTime) / 1000;
  const successRate = successCount / completedCount * 100;
  const ocrStats = scraper.captchaSolver.getStats();
  
  // Calculate estimated time remaining
  const studentsPerSecond = completedCount / elapsedSeconds;
  const remainingStudents = totalCount - completedCount;
  const estimatedRemainingTime = remainingStudents / studentsPerSecond;
  
  console.log('\n📊 PROGRESS REPORT 📊');
  console.log('═════════════════════════════════════════');
  console.log(`⏱️  Elapsed time: ${elapsedSeconds.toFixed(1)}s`);
  console.log(`🔄 Progress: ${completedCount}/${totalCount} (${(completedCount/totalCount*100).toFixed(1)}%)`);
  console.log(`✅ Success rate: ${successRate.toFixed(1)}%`);
  console.log(`⚡ Processing speed: ${studentsPerSecond.toFixed(2)} students/sec`);
  console.log(`⏳ Estimated time remaining: ${estimatedRemainingTime.toFixed(0)}s`);
  console.log(`🔍 OCR stats: ${ocrStats.successRate} success rate, avg ${ocrStats.averageTime}/captcha`);
  console.log('═════════════════════════════════════════');
}

/**
 * Main RGPV Scraper Application
 * With global error handling and graceful shutdown
 */
async function main() {
  try {
    // Ensure results directory exists
    const resultsDir = path.join(process.cwd(), 'results');
    if (!fs.existsSync(resultsDir)) {
      fs.mkdirSync(resultsDir, { recursive: true });
    }
    
    // Initialize worker pool with specified concurrency
    await scraper.captchaSolver.initWorkerPool(ocrConcurrency);
    
    const startTime = Date.now();
    let results = [];
    
    // Process based on selected mode
    if (mode === 'single') {
      console.log(`Starting single student processing for roll number ${prefix}${start}`);
      console.log(`System has ${os.cpus().length} CPU cores - using OCR queue with concurrency ${ocrConcurrency}`);
      
      // Process single roll number
      const rollNumber = `${prefix}${start}`;
      const result = await scraper.getResult(rollNumber, semester);
      
      results = [{ rollNumber, semester, success: result.success, data: result.data }];
      
      // Print detailed result for single student
      console.log('\nResult:');
      console.log('═════════════════════════════════════════');
      if (result.success) {
        console.log(`🎓 Student: ${result.data.student.name}`);
        console.log(`📝 Roll Number: ${rollNumber}`);
        console.log(`📊 SGPA: ${result.data.results.sgpa}`);
        console.log(`📈 CGPA: ${result.data.results.cgpa}`);
        console.log('🔹 Subjects:');
        if (result.data.subjects && Array.isArray(result.data.subjects)) {
          for (const subject of result.data.subjects) {
            console.log(`   - ${subject.subject}: ${subject.grade}`);
          }
        } else {
          console.log('   - No subject data available');
        }
      } else {
        console.log(`❌ Failed to get result for ${rollNumber}`);
        console.log(`Error: ${result.error}`);
      }
      console.log('═════════════════════════════════════════');
    } else {
      // Create roll number batch from range
      const studentBatch = [];
      for (let i = parseInt(start); i <= parseInt(end); i++) {
        const rollNumber = `${prefix}${i.toString().padStart(4, '0')}`;
        studentBatch.push({ rollNumber, semester });
      }
      
      console.log(`Starting batch processing for ${studentBatch.length} students with concurrency ${concurrency}`);
      console.log(`Roll number range: ${prefix}${start.padStart(4, '0')} to ${prefix}${end.padStart(4, '0')}`);
      console.log(`System has ${os.cpus().length} CPU cores - using OCR queue with concurrency ${ocrConcurrency}`);
      
      // Set up periodic status reports every 30 seconds
      const statusReportInterval = setInterval(() => {
        printStatusReport(results, startTime, studentBatch.length);
      }, 30000);
      
      // Set up periodic cleanup of temp files (every 2 minutes)
      const cleanupInterval = setInterval(() => {
        console.log('\n🧹 Performing periodic cleanup of temporary files...');
        try {
          // Only clean up files, don't terminate workers during processing
          scraper.captchaSolver.cleanupTempFiles();
        } catch (error) {
          console.error('Error during periodic cleanup:', error);
        }
      }, 120000);
      
      // Process the batch with higher concurrency (safe now with OCR queue)
      const batchResults = await scraper.batchProcess(studentBatch, concurrency, 
        // Progress callback
        (result) => {
          results.push(result);
          // Trigger status report every 10 results
          if (results.length % 10 === 0) {
            printStatusReport(results, startTime, studentBatch.length);
          }
        }
      );
      
      // Clear the intervals
      clearInterval(statusReportInterval);
      clearInterval(cleanupInterval);
      
      results = batchResults;
    }
    
    const endTime = Date.now();
    const duration = (endTime - startTime) / 1000;

    // Perform full cleanup of temporary files and directory
    console.log('\n🧹 Performing final cleanup of all temporary files...');
    try {
      // First use the built-in cleanup method
      await scraper.captchaSolver.cleanup();
      
      // Then ensure the temp directory is completely removed
      const tempDir = path.join(process.cwd(), 'temp_captchas');
      if (fs.existsSync(tempDir)) {
        const files = fs.readdirSync(tempDir);
        if (files.length > 0) {
          console.log(`Found ${files.length} remaining files in temp directory. Removing all...`);
          for (const file of files) {
            try {
              fs.unlinkSync(path.join(tempDir, file));
            } catch (e) {
              console.error(`Failed to delete file ${file}:`, e.message);
            }
          }
        }
        
        // Try to remove the directory itself
        try {
          fs.rmdirSync(tempDir);
          console.log(`Successfully removed temp_captchas directory`);
        } catch (e) {
          console.error(`Failed to remove temp_captchas directory:`, e.message);
        }
      }
    } catch (error) {
      console.error('Error during final cleanup:', error);
    }

    // Print results summary for batch mode
    if (mode === 'batch') {
      const successCount = results.filter(r => r.success).length;
      const failCount = results.length - successCount;
      
      console.log(`\nBatch processing complete in ${duration.toFixed(2)} seconds.`);
      console.log(`✅ Successful: ${successCount}/${results.length}`);
      console.log(`❌ Failed: ${failCount}/${results.length}`);
      console.log(`⏱️ Average processing time: ${(duration / results.length).toFixed(2)} seconds per student`);
      
      // Print a table of the first 20 results
      const topResults = results.slice(0, 20);
      
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
    }
    

  } catch (error) {
    console.error('Error in main process:', error);
  } finally {
    // Always clean up resources, especially Tesseract workers
    await cleanupResources();
  }
}

/**
 * Clean up all resources gracefully
 */
export async function cleanupResources() {
  console.log('Cleaning up resources...');
  try {
    await scraper.captchaSolver.cleanup();
    console.log("✅ Cleaned up all OCR resources and temporary files");
  } catch (error) {
    console.error("Error during cleanup:", error);
    
    // Last resort cleanup attempt for temp files
    try {
      const tempDir = path.join(process.cwd(), 'temp_captchas');
      if (fs.existsSync(tempDir)) {
        const files = fs.readdirSync(tempDir);
        console.log(`Emergency cleanup: attempting to delete ${files.length} remaining temp files`);
        
        for (const file of files) {
          try {
            fs.unlinkSync(path.join(tempDir, file));
          } catch (e) {
            // Ignore individual file deletion errors in emergency cleanup
          }
        }
      }
    } catch (cleanupError) {
      console.error("Error during emergency cleanup:", cleanupError);
    }
  }
}

// Add graceful shutdown handlers
process.on('SIGINT', async () => {
  console.log('\nReceived SIGINT. Shutting down gracefully...');
  await cleanupResources();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\nReceived SIGTERM. Shutting down gracefully...');
  await cleanupResources();
  process.exit(0);
});

// Handle uncaught exceptions
process.on('uncaughtException', async (error) => {
  console.error('\nUncaught exception:', error);
  await cleanupResources();
  process.exit(1);
});

// Show help if requested
if (process.argv.includes('--help')) {
  printHelp();
} else {
  // Run the main function
  main().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

export default { scraper, main, cleanupResources }; 