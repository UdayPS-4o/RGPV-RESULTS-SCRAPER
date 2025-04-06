import fetch from 'node-fetch';
import * as cheerio from 'cheerio';
import fs from 'fs';
import path from 'path';

/**
 * Class responsible for submitting forms with solved CAPTCHAs and processing the results
 */
class ResultSubmitter {
  constructor(debug = false) {
    this.debug = debug;
  }

  /**
   * Submit a form with a solved CAPTCHA
   * @param {string} rollNumber - Student's roll number
   * @param {string} semester - Semester number
   * @param {Object} captchaData - Solved CAPTCHA data
   * @returns {Promise<Object|boolean>} - The result data or false if failed
   */
  async submitFormWithCaptcha(rollNumber, semester, captchaData) {
    try {
      if (this.debug) console.log(`Submitting form for roll number: ${rollNumber}, semester: ${semester}`);
      
      if (!captchaData) {
        console.error('No CAPTCHA data provided');
        return { success: false, error: 'No CAPTCHA data provided' };
      }
      
      if (this.debug) console.log(`Using CAPTCHA solution: ${captchaData.captchaText}`);
      
      // Create the request body with the solved CAPTCHA
      const requestBody = {
        "__EVENTTARGET": "",
        "__EVENTARGUMENT": "",
        "__VIEWSTATE": captchaData.jsonData.inputs.__VIEWSTATE,
        "__VIEWSTATEGENERATOR": captchaData.jsonData.inputs.__VIEWSTATEGENERATOR, 
        "__EVENTVALIDATION": captchaData.jsonData.inputs.__EVENTVALIDATION,
        "ctl00$ContentPlaceHolder1$txtrollno": rollNumber,
        "ctl00$ContentPlaceHolder1$drpSemester": semester,
        "ctl00$ContentPlaceHolder1$rbtnlstSType": "G", // G for Grading
        "ctl00$ContentPlaceHolder1$TextBox1": captchaData.captchaText,
        "ctl00$ContentPlaceHolder1$btnviewresult": "View Result"
      };
      
      // Convert to URL-encoded format
      const formBody = Object.entries(requestBody)
        .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
        .join('&');
      
      if (this.debug) console.log('Sending request with solved CAPTCHA...');
      
      // Send the request
      const response = await fetch("https://result.rgpv.ac.in/Result/BErslt.aspx", {
        "headers": {
          "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
          "accept-language": "en-US,en;q=0.9",
          "cache-control": "no-cache",
          "content-type": "application/x-www-form-urlencoded",
          "pragma": "no-cache",
          "sec-ch-ua": "\"Brave\";v=\"135\", \"Not-A.Brand\";v=\"8\", \"Chromium\";v=\"135\"",
          "sec-ch-ua-mobile": "?0",
          "sec-ch-ua-platform": "\"Windows\"",
          "sec-fetch-dest": "document",
          "sec-fetch-mode": "navigate",
          "sec-fetch-site": "same-origin",
          "sec-fetch-user": "?1",
          "upgrade-insecure-requests": "1",
          "cookie": `ASP.NET_SessionId=${captchaData.jsonData.sessionId}`,
          "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36"
        },
        "referrer": "https://result.rgpv.ac.in/Result/BErslt.aspx",
        "referrerPolicy": "strict-origin-when-cross-origin",
        "body": formBody,
        "method": "POST"
      });
      
      // Get and save the response
      const html = await response.text();
      
      if (this.debug) {
        const debugDir = path.join(process.cwd(), 'db');
        if (!fs.existsSync(debugDir)) {
          fs.mkdirSync(debugDir, { recursive: true });
        }
        fs.writeFileSync(path.join(debugDir, 'result.html'), html);
        console.log('Result saved to db/result.html');
        
        // Save debug information
        const debugInfo = {
          timestamp: new Date().toISOString(),
          sessionId: captchaData.jsonData.sessionId,
          captcha: captchaData.captchaText,
          rollNumber,
          semester,
          responseSize: html.length,
          containsInvalidCaptcha: html.includes("Invalid Captcha Code"),
          containsNoRollNumber: html.includes("Roll No does not exist"),
          containsResultTable: html.includes("Result") && html.includes("Grade"),
          headers: response.headers.raw()
        };
        
        fs.writeFileSync(path.join(debugDir, 'debug_info.json'), JSON.stringify(debugInfo, null, 2));
        console.log('Debug info saved to db/debug_info.json');
      }
      
      // Check if response contains error message or success indicators
      if (html.includes("Invalid Captcha Code")) {
        return { success: false, error: "Invalid CAPTCHA code entered" };
      } else if (html.includes("Roll No does not exist")) {
        return { success: false, error: "Roll number does not exist" };
      } else if (html.includes("Site Under Construction") || html.includes("under maintenance")) {
        return { success: false, error: "Site is under maintenance" };
      } else if (html.includes("Result") && html.includes("Grade")) {
        // Success! Process and save the result data as JSON
        if (this.debug) console.log("Success! Found result data for student");
        
        // Extract and save the result data
        const resultData = this.extractResultData(html);
        
        if (resultData) {
          // Ensure results directory exists
          const resultsDir = path.join(process.cwd(), 'results');
          if (!fs.existsSync(resultsDir)) {
            fs.mkdirSync(resultsDir, { recursive: true });
          }
          
          // Save JSON file
          const jsonPath = path.join(resultsDir, `${rollNumber}.json`);
          fs.writeFileSync(jsonPath, JSON.stringify(resultData, null, 2));
          if (this.debug) console.log(`Result data saved to ${jsonPath}`);
          
          return {
            success: true,
            data: resultData
          };
        }
        
        return {
          success: true,
          data: null,
          message: "Result found but could not extract data"
        };
      } else {
        if (this.debug) {
          console.log("Response received, but cannot determine success/failure");
          console.log("HTML contains 'Student': " + html.includes("Student"));
          console.log("HTML contains 'Name': " + html.includes("Name"));
          console.log("HTML contains 'Error': " + html.includes("Error"));
        }
        return { 
          success: false, 
          error: "Unexpected response from server" 
        };
      }
      
    } catch (error) {
      console.error('Error in submitting form:', error);
      return { 
        success: false, 
        error: error.message || String(error)
      };
    }
  }

  /**
   * Extract data from result HTML and save as JSON
   * @param {string} html - HTML response from the server
   * @returns {Object|null} - Extracted data or null if failed
   */
  extractResultData(html) {
    try {
      const $ = cheerio.load(html);
      
      // Create result object
      const result = {
        university: $('.resultheader').text().trim(),
        session: $('#ctl00_ContentPlaceHolder1_lblSession').text().trim(),
        student: {
          name: $('#ctl00_ContentPlaceHolder1_lblNameGrading').text().trim(),
          roll_no: $('#ctl00_ContentPlaceHolder1_lblRollNoGrading').text().trim(),
          course: $('#ctl00_ContentPlaceHolder1_lblProgramGrading').text().trim(),
          branch: $('#ctl00_ContentPlaceHolder1_lblBranchGrading').text().trim(),
          semester: $('#ctl00_ContentPlaceHolder1_lblSemesterGrading').text().trim(),
          status: $('#ctl00_ContentPlaceHolder1_lblStatusGrading').text().trim(),
        },
        subjects: [],
        results: {
          description: $('#ctl00_ContentPlaceHolder1_lblResultNewGrading').text().trim(),
          sgpa: $('#ctl00_ContentPlaceHolder1_lblSGPA').text().trim(),
          cgpa: $('#ctl00_ContentPlaceHolder1_lblcgpa').text().trim(),
        },
        revaluationDates: {
          normal: $('#ctl00_ContentPlaceHolder1_Label4NewGrading').text().trim(),
          late: $('#ctl00_ContentPlaceHolder1_Label5NewGrading').text().trim()
        }
      };
      
      // Collecting marks details from subject tables
      const marksTables = $('.gridtable');
      marksTables.each((index, table) => {
        // Skip first table and last three tables (as per original logic)
        if (index > 0 && index < marksTables.length - 3) {
          $(table).find('tr').each((rowIndex, row) => {
            const cells = $(row).find('td');
            if (cells.length > 0) { // Avoid headers
              const subject = {
                subject: $(cells[0]).text().trim(),
                total_credit: $(cells[1]).text().trim(),
                earned_credit: $(cells[2]).text().trim(),
                grade: $(cells[3]).text().trim(),
              };
              
              // Skip the student data rows that get mistakenly picked up as subjects
              if (subject.subject !== 'Name' && 
                  subject.subject !== 'Course' && 
                  subject.subject !== 'Semester') {
                result.subjects.push(subject);
              }
            }
          });
        }
      });
      
      return result;
    } catch (error) {
      console.error('Error extracting result data:', error);
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
}

export default ResultSubmitter; 