import { readdirSync, readFileSync } from 'fs';
import pkg from 'exceljs';
import path from 'path';
const { Workbook } = pkg;

// Parse command line arguments
function parseArgs() {
    const args = process.argv.slice(2);
    const config = {
        inputFolder: './results',
        outputFile: 'Results.xlsx'
    };
    
    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        
        if ((arg === '--input' || arg === '-i') && i + 1 < args.length) {
            config.inputFolder = args[++i];
        } else if ((arg === '--output' || arg === '-o') && i + 1 < args.length) {
            config.outputFile = args[++i];
        } else if (arg === '--help' || arg === '-h') {
            printHelp();
            process.exit(0);
        }
    }
    
    return config;
}

// Print help message
function printHelp() {
    console.log(`
Excel Converter for RGPV Results

Usage: node combine.js [options]

Options:
  -i, --input <path>     Input folder containing JSON result files (default: ./results)
  -o, --output <path>    Output Excel file path (default: Results.xlsx)
  -h, --help             Show this help message
  
Examples:
  node combine.js
  node combine.js --input ./results/cs23 --output CS_Results.xlsx
  node combine.js -i ./results/it23 -o IT_Results.xlsx
    `);
}

const readStudentData = (folderPath) => {
    const files = readdirSync(folderPath);
    const students = [];
    files.forEach(file => {
        if (file.endsWith('.json')) {
            const filePath = `${folderPath}/${file}`;
            const data = JSON.parse(readFileSync(filePath, 'utf-8'));
            const studentInfo = {
                name: data.student.name,
                rollNo: data.student.roll_no,
                cgpa: data.results.cgpa,
                sgpa: data.results.sgpa,
            };
            data.subjects.forEach(subject => {
                if (typeof subject.grade === 'string') {
                    studentInfo[subject.subject] = subject.grade;
                }
            });
            students.push(studentInfo);
        }
    });
    return students;
};


const createExcelFile = (students, outputPath) => {
    const workbook = new Workbook();
    const worksheet = workbook.addWorksheet('Results');
    
    // const headers = ['Name', 'Roll No', 'CGPA'];
    const headers = ['name', 'rollNo', 'cgpa', 'sgpa'];
    const exampleStudent = students[0];
    for (const key in exampleStudent) {
        if (!headers.includes(key) && key !== 'name' && key !== 'rollNo' && key !== 'cgpa') {
            headers.push(key);
        }
    }
    worksheet.addRow(headers);

    students.forEach(student => {
        const row = headers.map(header => student[header] || '');
        worksheet.addRow(row);
    });

    students.forEach((student, index) => {
        headers.forEach((header, colIndex) => {
            const cell = worksheet.getRow(index + 2).getCell(colIndex + 1);
            if (cell.value === 'F' || cell.value === 'F (ABS)') {
                cell.fill = {
                    type: 'pattern',
                    pattern: 'solid',
                    fgColor: { argb: 'FFFF0000' } 
                };
            } else if (cell.value === 'D##') {
                cell.fill = {
                    type: 'pattern',
                    pattern: 'solid',
                    fgColor: { argb: 'FFDDDDDD' } 
                };
            }
        });
    });

    // Save the workbook
    workbook.xlsx.writeFile(outputPath);
};

// Main function to run the script
const main = () => {
    // Get configuration from command line arguments
    const config = parseArgs();
    const { inputFolder, outputFile } = config;
    
    console.log(`Reading results from: ${inputFolder}`);
    console.log(`Writing Excel to: ${outputFile}`);
    
    try {
        const students = readStudentData(inputFolder);
        if (students.length === 0) {
            console.error(`No JSON files found in ${inputFolder}`);
            process.exit(1);
        }
        
        createExcelFile(students, outputFile);
        console.log(`Excel file created successfully with ${students.length} student records!`);
    } catch (error) {
        console.error(`Error: ${error.message}`);
        if (error.code === 'ENOENT') {
            console.error(`Directory not found: ${inputFolder}`);
        }
        process.exit(1);
    }
};

main();
