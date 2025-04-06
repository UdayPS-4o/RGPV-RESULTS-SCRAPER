# RGPV Result Scraper

A powerful Node.js tool for fetching student results from RGPV (Rajiv Gandhi Proudyogiki Vishwavidyalaya) website. This scraper handles CAPTCHA solving, result parsing, and can process both individual students and batches of students.

## Features

- **Automatic CAPTCHA solving** using OCR (Optical Character Recognition)
- **Both single and batch processing** modes for fetching student results
- **Robust error handling** and automatic retries for failed requests
- **Concurrent processing** to speed up batch operations
- **Result storage** in JSON format for further analysis
- **Auto-cleanup** of temporary files after processing
- **Excel export** for easy analysis and sharing of results

## Installation

1. Ensure you have Node.js installed (v14+ recommended)
2. Clone this repository
3. Install dependencies:

```bash
npm install
```

## Usage

The tool can be run in two modes:

### Single Student Mode

To fetch the result for a single student:

```bash
node index.js --single --rollno 0818CS231001 --semester 3
```

Or alternatively:

```bash
node index.js --single --prefix 0818CS23 --start 1001 --semester 3
```

### Batch Processing Mode

To fetch results for a batch of students:

```bash
node index.js --batch --prefix 0818CS23 --start 1001 --end 1234 --semester 3
```

Or simply (batch is the default mode):

```bash
node index.js --prefix 0818CS23 --start 1001 --end 1234 --semester 3
```

### Converting Results to Excel

After fetching results, you can convert them to Excel format for easier analysis:

```bash
node combine.js
```

By default, the script reads JSON files from the `results` directory and generates an Excel file named `Results.xlsx`. You can customize the input directory and output filename using command line arguments:

```bash
# Specify custom input folder and output file
node combine.js --input ./results/cs23 --output CS_Results.xlsx

# Using short form arguments
node combine.js -i ./results/it23 -o IT_Results.xlsx

# Show help for available options
node combine.js --help
```

Available options:
- `-i, --input <path>`: Input folder containing JSON result files (default: ./results)
- `-o, --output <path>`: Output Excel file path (default: Results.xlsx)
- `-h, --help`: Show help message

The Excel output includes:
- Student names and roll numbers
- CGPA and SGPA scores
- Individual subject grades
- Color-coded cells for failures (red) and special cases (gray)

## Command Line Options

- `--single`: Process a single student
- `--batch`: Process a batch of students (default)
- `--rollno <string>`: Full roll number for single processing (e.g., 0818CS231001)
- `--prefix <string>`: Roll number prefix (default: 0818CS23)
- `--start <string>`: Start roll number - last 4 digits (default: 1001)
- `--end <string>`: End roll number - last 4 digits (default: 1234)
- `--semester <string>`: Semester to fetch (default: 3)
- `--concurrency <number>`: Number of parallel requests (default: 12)
- `--ocr-concurrency <number>`: Number of OCR workers (default: 2)
- `--debug`: Enable debug mode (default: true)
- `--no-debug`: Disable debug mode
- `--help`: Show help message

## Results

Results are saved in the `results` directory in JSON format. For batch processing, a sample of the first 20 results is displayed in the console.

## File Cleanup

The scraper automatically cleans up temporary files created during CAPTCHA processing:
- During batch processing, cleanup happens every 2 minutes
- After processing completes, all temporary files and directories are removed

## Notes

- Increase the `--concurrency` value to speed up batch processing
- The `--ocr-concurrency` value should be set based on your CPU resources (2-4 is recommended for most systems)
- Results are stored in the `results` directory.