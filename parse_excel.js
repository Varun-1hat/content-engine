const xlsx = require('xlsx');
const fs = require('fs');

try {
  const workbook = xlsx.readFile('./Dr_Kiran_IG_Strategy.xlsx');
  const sheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];
  const json = xlsx.utils.sheet_to_json(worksheet);
  fs.writeFileSync('./strategy_dump.json', JSON.stringify(json, null, 2));
  console.log('Successfully parsed Excel to strategy_dump.json');
} catch (error) {
  console.error('Error parsing Excel:', error);
}
