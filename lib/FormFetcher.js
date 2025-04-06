import fetch from 'node-fetch';
import * as cheerio from 'cheerio';
import fs from 'fs';
import path from 'path';

/**
 * Class responsible for fetching the initial form data and session
 * from the RGPV website
 */
class FormFetcher {
  constructor(debug = false) {
    this.debug = debug;
    this.sessionId = '';
  }

  /**
   * Fetch initial data from RGPV website
   * @returns {Promise<Object|null>} The scraped data or null if failed
   */
  async fetchInitialData() {
    try {
      // Step 1: GET request to ProgramSelect.aspx
      if (this.debug) console.log('Step 1: Initial GET request to ProgramSelect.aspx');
      
      const initialResponse = await fetch('https://result.rgpv.ac.in/Result/ProgramSelect.aspx', {
        headers: {
          'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
          'accept-language': 'en-US,en;q=0.9',
          'cache-control': 'max-age=0',
          'sec-ch-ua': '"Chromium";v="134", "Not:A-Brand";v="24", "Google Chrome";v="134"',
          'sec-ch-ua-mobile': '?0',
          'sec-ch-ua-platform': '"Windows"',
          'sec-fetch-dest': 'document',
          'sec-fetch-mode': 'navigate',
          'sec-fetch-site': 'none',
          'sec-fetch-user': '?1',
          'upgrade-insecure-requests': '1',
          'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36'
        }
      });
      
      // Check for cookies in response
      const setCookie = initialResponse.headers.get('set-cookie');
      const cookieHeader = setCookie ? setCookie : '';
      if (this.debug) console.log(`Response cookies: ${cookieHeader}`);
      
      // Extract the ASP.NET_SessionId if present
      this.sessionId = '';
      if (cookieHeader && cookieHeader.includes('ASP.NET_SessionId=')) {
        this.sessionId = cookieHeader.split('ASP.NET_SessionId=')[1].split(';')[0];
        if (this.debug) console.log(`Extracted session ID: ${this.sessionId}`);
      }
      
      const initialHtml = await initialResponse.text();
      if (this.debug) {
        const debugDir = path.join(process.cwd(), 'db');
        if (!fs.existsSync(debugDir)) {
          fs.mkdirSync(debugDir, { recursive: true });
        }
        fs.writeFileSync(path.join(debugDir, 'initial_response.html'), initialHtml);
        console.log('Initial response HTML saved to db/initial_response.html');
      }
      
      const $ = cheerio.load(initialHtml);
      
      // Extract form inputs for the POST request
      const formInputs = {};
      $('form input').each((i, input) => {
        const name = $(input).attr('name');
        const value = $(input).attr('value') || '';
        
        if (name) {
          formInputs[name] = value;
        }
      });
      
      // Also check for radio buttons
      $('input[type="radio"]').each((i, radio) => {
        const name = $(radio).attr('name');
        const value = $(radio).attr('value') || '';
        
        if (name && $(radio).attr('checked')) {
          formInputs[name] = value;
        }
      });
      
      if (this.debug) console.log('Extracted form inputs:', formInputs);
      
      // Step 2: POST request to ProgramSelect.aspx to select program
      if (this.debug) console.log('Step 2: POST request to ProgramSelect.aspx with program selection');
      
      // Prepare POST body exactly as seen in HAR file
      const postBody = new URLSearchParams();
      postBody.append('__EVENTTARGET', 'radlstProgram$1');
      postBody.append('__EVENTARGUMENT', '');
      postBody.append('__LASTFOCUS', '');
      postBody.append('__VIEWSTATE', formInputs['__VIEWSTATE'] || '');
      postBody.append('__VIEWSTATEGENERATOR', formInputs['__VIEWSTATEGENERATOR'] || '');
      postBody.append('__EVENTVALIDATION', formInputs['__EVENTVALIDATION'] || '');
      postBody.append('radlstProgram', '24'); // Value 24 for B.E. program
      
      // Create cookie header
      const cookieStr = this.sessionId ? `ASP.NET_SessionId=${this.sessionId}` : '';
      
      // Send POST request
      const postResponse = await fetch('https://result.rgpv.ac.in/Result/ProgramSelect.aspx', {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
          'accept-language': 'en-US,en;q=0.9',
          'cache-control': 'max-age=0',
          'sec-ch-ua': '"Chromium";v="134", "Not:A-Brand";v="24", "Google Chrome";v="134"',
          'sec-ch-ua-mobile': '?0',
          'sec-ch-ua-platform': '"Windows"',
          'sec-fetch-dest': 'document',
          'sec-fetch-mode': 'navigate',
          'sec-fetch-site': 'same-origin',
          'sec-fetch-user': '?1',
          'upgrade-insecure-requests': '1',
          'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36',
          ...(cookieStr ? { 'cookie': cookieStr } : {})
        },
        redirect: 'manual', // Important! Don't automatically follow redirects
        body: postBody.toString()
      });
      
      // Check response status and headers
      if (this.debug) console.log(`POST response status: ${postResponse.status}`);
      
      // Check for updated cookies
      const postCookie = postResponse.headers.get('set-cookie');
      if (postCookie) {
        if (this.debug) console.log(`New cookies from POST: ${postCookie}`);
        if (postCookie.includes('ASP.NET_SessionId=')) {
          this.sessionId = postCookie.split('ASP.NET_SessionId=')[1].split(';')[0];
          if (this.debug) console.log(`Updated session ID: ${this.sessionId}`);
        }
      }
      
      // Check for redirect location
      const location = postResponse.headers.get('location');
      if (this.debug) console.log(`Redirect location: ${location || 'No redirect'}`);
      
      // If there's a redirect to BErslt.aspx, follow it
      if (location && location.includes('BErslt.aspx')) {
        if (this.debug) console.log('Following redirect to BErslt.aspx');
        
        // Step 3: GET request to BErslt.aspx following the redirect
        const resultUrl = new URL(location, 'https://result.rgpv.ac.in').href;
        if (this.debug) console.log(`Making GET request to: ${resultUrl}`);
        
        const resultResponse = await fetch(resultUrl, {
          headers: {
            'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
            'accept-language': 'en-US,en;q=0.9',
            'cache-control': 'max-age=0',
            'sec-ch-ua': '"Chromium";v="134", "Not:A-Brand";v="24", "Google Chrome";v="134"',
            'sec-ch-ua-mobile': '?0',
            'sec-ch-ua-platform': '"Windows"',
            'sec-fetch-dest': 'document',
            'sec-fetch-mode': 'navigate',
            'sec-fetch-site': 'same-origin',
            'sec-fetch-user': '?1',
            'upgrade-insecure-requests': '1',
            'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36',
            ...(this.sessionId ? { 'cookie': `ASP.NET_SessionId=${this.sessionId}` } : {})
          }
        });
        
        // Check for final cookies
        const finalCookie = resultResponse.headers.get('set-cookie');
        if (finalCookie) {
          if (this.debug) console.log(`New cookies from result page: ${finalCookie}`);
          if (finalCookie.includes('ASP.NET_SessionId=')) {
            this.sessionId = finalCookie.split('ASP.NET_SessionId=')[1].split(';')[0];
            if (this.debug) console.log(`Final session ID: ${this.sessionId}`);
          }
        }
        
        const resultHtml = await resultResponse.text();
        if (this.debug) {
          fs.writeFileSync(path.join(process.cwd(), 'db', 'result_page.html'), resultHtml);
          console.log('Result page HTML saved to db/result_page.html');
        }
        
        const $result = cheerio.load(resultHtml);
        
        // Extract form inputs
        const resultFormInputs = {};
        $result('form input').each((i, input) => {
          const name = $result(input).attr('name');
          const value = $result(input).attr('value') || '';
          
          if (name) {
            resultFormInputs[name] = value;
          }
        });
        
        // Look for captcha image
        const captchaImg = $result('img[src*="CaptchaImage.axd"]');
        const captchaImage = captchaImg.attr('src') || '';
        
        // Create output data
        const result = {
          timestamp: new Date().toISOString(),
          sessionId: this.sessionId,
          inputs: resultFormInputs,
          captchaImage,
        };
        
        if (this.debug) console.log('Scraped form data:', { ...result, inputs: 'HIDDEN' });
        return result;
      } else {
        console.error('No redirect to BErslt.aspx found');
        return null;
      }
      
    } catch (error) {
      console.error('Error in fetching initial data:', error);
      return null;
    }
  }

  /**
   * Get the current session ID
   * @returns {string} The current session ID
   */
  getSessionId() {
    return this.sessionId;
  }
  
  /**
   * Set debug mode
   * @param {boolean} debug Whether to enable debug mode
   */
  setDebug(debug) {
    this.debug = debug;
  }
}

export default FormFetcher; 