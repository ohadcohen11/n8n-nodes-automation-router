# Ryze Automation Router - n8n Custom Node Development Context

## Project Overview

This is a custom n8n node called **Ryze Automation Router** that consolidates complex workflow logic for Ryze Beyond's affiliate marketing automation system. The node replaces 15-20 nodes per workflow across 400+ scrapers.

**Repository:** Based on n8n-nodes-starter template  
**Package Name:** `@ryze-beyond/n8n-nodes-automation-router`  
**Node Name:** `ryzeAutomationRouter`  
**Display Name:** `Ryze Automation Router`

---

## What This Node Does

### Primary Function
Routes affiliate marketing data to either:
1. **TrafficPoint Pixel API** (regular hourly runs) - with MySQL deduplication
2. **AWS S3** (monthly runs on 2nd of month) - for discrepancy analysis

### Key Features
- ✅ Auto-detects execution mode (monthly vs regular)
- ✅ Handles multiple io_ids per workflow (multi-brand support)
- ✅ MySQL deduplication before sending to pixel
- ✅ Groups data by io_id and creates separate S3 files per brand
- ✅ Dry run mode for testing without sending/uploading
- ✅ Force execution modes for manual testing
- ✅ Detailed execution metrics output

---

## Node Configuration Parameters

### Required Parameters

1. **Script ID** (string)
   - Your scraper script ID
   - Example: `"2000"`

2. **Main IO ID** (string)
   - Primary brand IO ID for translated data
   - Example: `"545f8472fe0af42e7bbb6903"`

3. **Execution Mode** (options)
   - `auto` - Auto-detect from trigger (default)
   - `forceRegular` - Always send to TrafficPoint (testing)
   - `forceMonthly` - Always upload to S3 (testing)

### Required Credentials

1. **MySQL** - For deduplication and brand lookup
2. **AWS** - For S3 uploads
3. **TrafficPoint API** - Custom credential with cookie header

### Optional Parameters (in Options collection)

- **Dry Run Mode** (boolean) - Test without sending/uploading
- **Translator Node Name** (string) - Default: "Translator"
- **Skip Deduplication** (boolean) - Force send all items
- **S3 Bucket Name** (string) - Default: "ryze-data-brand-performance"
- **Verbose Logging** (boolean) - Include debug info
- **MySQL Database** (string) - Default: "cms"
- **BO MySQL Database** (string) - Default: "bo"

---

## Input Data Schema

The node expects processed events with this 9-field schema:

```javascript
{
  "date": "2025-12-07T12:00:00",           // ISO format ending in T12:00:00
  "token": "abc123",                        // Affiliate token/PID
  "event": "sale",                          // lead, sale, ftd, etc.
  "trx_id": "brand-sale-abc123",           // Unique transaction ID
  "io_id": "545f8472fe0af42e7bbb6903",     // Brand identifier
  "commission_amount": 100,                 // Commission in dollars
  "amount": 500,                            // Transaction amount
  "currency": "USD",                        // Currency code
  "parent_api_call": "Empty"                // Source reference
}
```

**Multi-Brand Support:** Items can have different `io_id` values - the node automatically groups and processes them separately.

---

## Output Data Schema

### Regular Run Output

```javascript
{
  "execution": {
    "mode": "regular",
    "dry_run": false,
    "timestamp": "2025-12-07T15:30:45.123Z",
    "duration_ms": 2341
  },
  "summary": {
    "total_input": 50,
    "duplicates_found": 8,
    "sent_to_pixel": 42,
    "pixel_success": 40,
    "pixel_failed": 2,
    "inserted_to_db": 40
  },
  "details": {
    "duplicate_trx_ids": ["brand-sale-123", ...],
    "failed_sends": [
      {
        "trx_id": "brand-sale-789",
        "io_id": "545f...",
        "error": "Timeout after 30s",
        "amount": 500,
        "commission_amount": 100
      }
    ]
  },
  "metrics": {
    "mysql_check_ms": 120,
    "pixel_send_ms": 2100,
    "mysql_insert_ms": 121
  }
}
```

### Monthly Run Output

```javascript
{
  "execution": {
    "mode": "monthly",
    "dry_run": false,
    "timestamp": "2025-12-02T03:00:15.456Z",
    "duration_ms": 5432
  },
  "summary": {
    "files_created": 4,
    "translated_rows": 1847,
    "processed_rows": 1740,
    "brands_processed": 3
  },
  "uploads": [
    {
      "type": "Translated",
      "io_id": "545f8472fe0af42e7bbb6903",
      "brand_group_id": 123,
      "brand_group_name": "eHarmony Group",
      "path": "AutomationDiscrepancy/2025/11/123/545f_2000_Translated.csv",
      "s3_url": "s3://bucket/path/to/file.csv",
      "rows": 1847,
      "size_kb": 423,
      "upload_duration_ms": 1234
    },
    // ... more files for each io_id
  ],
  "metrics": {
    "mysql_queries_ms": 234,
    "csv_generation_ms": 456,
    "s3_upload_total_ms": 4036
  }
}
```

---

## Current Build Issues

### TypeScript Compilation Errors

There are currently **5 TypeScript errors** preventing compilation:

1. **Lines 193 & 206:** Method call errors
   ```
   Property 'handleMonthlyRun' does not exist on type 'IExecuteFunctions'
   Property 'handleRegularRun' does not exist on type 'IExecuteFunctions'
   ```
   
   **Problem:** Methods are being called on `this` (which is `IExecuteFunctions`) but they're private methods of the `RyzeAutomationRouter` class.
   
   **Solution:** The methods are already correctly passing `this` as a context parameter. The calls should work. Need to verify the TypeScript is seeing the class methods properly.

2. **Lines 233 & 322:** Unused method warnings
   ```
   'handleRegularRun' is declared but its value is never read
   'handleMonthlyRun' is declared but its value is never read
   ```
   
   **Problem:** TypeScript thinks these methods aren't being used, but they are called in the execute method.
   
   **Solution:** This is likely a false positive due to the method signature pattern. Can be ignored or suppressed.

3. **Line 475:** Unused variable
   ```
   'options' is declared but its value is never read
   ```
   
   **Problem:** Variable declared but not used in `getTranslatedData` method.
   
   **Solution:** Remove the line: `const options = context.getNodeParameter('options', 0, {}) as any;`

---

## Project Structure

```
ryze-automation-router/
├── package.json
├── tsconfig.json
├── gulpfile.js
├── credentials/
│   └── TrafficPointApi.credentials.ts
├── nodes/
│   └── RyzeAutomationRouter/
│       ├── RyzeAutomationRouter.node.ts   ← Main file with errors
│       └── ryze.svg                        ← Icon (placeholder)
├── dist/                                   ← Generated after build
└── node_modules/
```

---

## Key Implementation Details

### Method Signatures

All helper methods follow this pattern (passing context as first parameter):

```typescript
private async checkDuplicates(
    context: IExecuteFunctions,
    items: any[],
    mysqlDb: string
): Promise<string[]> {
    const credentials = await context.getCredentials('mysql');
    // ... implementation
}
```

### Regular Run Flow

```
Input Items
    ↓
Check MySQL for duplicates (batch query)
    ↓
Filter out existing trx_ids
    ↓
Send to TrafficPoint API (with cookie auth)
    ↓
Insert successful sends to MySQL
    ↓
Return detailed metrics
```

### Monthly Run Flow

```
Input Items
    ↓
Group by io_id (multi-brand support)
    ↓
For each io_id:
    - Query MySQL for brand_group_id
    - Generate CSV
    - Upload to S3 path: 
      AutomationDiscrepancy/YYYY/MM/{brand_group_id}/{io_id}_{script_id}_Processed.csv
    ↓
Return upload results
```

### Multi-Brand Handling

Example input with 3 brands:
```javascript
[
  { io_id: "aaa-111", trx_id: "brandA-sale-1", ... },
  { io_id: "aaa-111", trx_id: "brandA-sale-2", ... },
  { io_id: "bbb-222", trx_id: "brandB-lead-1", ... },
  { io_id: "ccc-333", trx_id: "brandC-ftd-1", ... }
]
```

Creates 3 separate S3 files:
- `aaa-111_2000_Processed.csv` (2 rows)
- `bbb-222_2000_Processed.csv` (1 row)
- `ccc-333_2000_Processed.csv` (1 row)

---

## Database Schema References

### cms.scraper_tokens
```sql
CREATE TABLE cms.scraper_tokens (
  id INT AUTO_INCREMENT PRIMARY KEY,
  trx_id VARCHAR(255) UNIQUE,
  amount DECIMAL(10,2),
  commission_amount DECIMAL(10,2),
  stream VARCHAR(50),
  created_at DATETIME
);
```

### bo.out_brands & bo.brands_groups
```sql
-- Used to lookup brand_group_id from io_id
SELECT bg.id as brand_group_id, bg.name as brand_group_name 
FROM bo.out_brands AS b 
LEFT JOIN bo.brands_groups AS bg ON b.brands_group_id = bg.id 
WHERE b.mongodb_id = ? 
LIMIT 1
```

---

## TrafficPoint API Integration

### Endpoint
`https://pixel.trafficpointltd.com/scraper`

### Authentication
Custom credential type with cookie header:
```
Cookie: SES_TOKEN=...; VIEWER_TOKEN=...
```

### Payload Format
```javascript
{
  "trackInfo": {
    "tokenId": "",
    "track_type": "event",
    "date": "2025-12-07T12:00:00",
    "timestamp": "2025-12-07T15:30:45.123456Z"
  },
  "params": {
    "commission_amount": 100,
    "currency": "USD",
    "amount": 500,
    "ioId": "545f8472fe0af42e7bbb6903"
  },
  "trxId": "brand-sale-abc123",
  "eventName": "sale",
  "source_token": "abc123",
  "parent_api_call": "{\"parent_api_call\":\"Empty\"}"
}
```

### Expected Response
```javascript
{ "status": "OK" }
// or
{ "status": "ERROR", "error": "Error message" }
```

---

## AWS S3 Integration

### Bucket
`ryze-data-brand-performance`

### File Path Pattern
```
AutomationDiscrepancy/YYYY/MM/{brand_group_id}/{io_id}_{script_id}_{type}.csv
```

Example:
```
AutomationDiscrepancy/2025/11/123/545f8472fe0af42e7bbb6903_2000_Translated.csv
AutomationDiscrepancy/2025/11/123/545f8472fe0af42e7bbb6903_2000_Processed.csv
AutomationDiscrepancy/2025/11/456/aaa-111-different-brand_2000_Processed.csv
```

---

## Testing Strategy

### Test 1: Dry Run Regular Mode
```
Mode: Force Regular Run
Dry Run: ✅ ON
Result: Shows what would be sent to pixel without actually sending
```

### Test 2: Dry Run Monthly Mode
```
Mode: Force Monthly Run  
Dry Run: ✅ ON
Result: Shows what files would be created without uploading
```

### Test 3: Actual Regular Run
```
Mode: Auto (or Force Regular Run)
Dry Run: ❌ OFF
Result: Sends to TrafficPoint and inserts to MySQL
```

### Test 4: Actual Monthly Run
```
Mode: Force Monthly Run
Dry Run: ❌ OFF
Result: Uploads CSV files to S3
```

---

## What Needs to Be Fixed

### Immediate Priority

1. **Fix TypeScript compilation errors** (5 errors)
   - Method call issues on lines 193 & 206
   - Remove unused variable on line 475
   - Suppress/fix unused method warnings on lines 233 & 322

2. **Create icon file** (`nodes/RyzeAutomationRouter/ryze.svg`)
   - Currently expects `file:ryze.svg`
   - Placeholder SVG is fine for now

3. **Test compilation**
   ```bash
   npm run build
   ```

### Secondary Tasks

4. **Implement proper translator data fetching** (currently returns empty array)
   - Line 472-479 in `getTranslatedData()` method
   - Need to access workflow execution context

5. **Test with real n8n instance**
   - Link the node to n8n
   - Create test workflow
   - Validate all modes work

6. **Add error handling improvements**
   - Retry logic for TrafficPoint API
   - Better MySQL connection pooling
   - S3 upload error handling

---

## Dependencies

```json
{
  "dependencies": {
    "aws-sdk": "^2.1498.0",
    "mysql2": "^3.6.5"
  },
  "devDependencies": {
    "@types/node": "^20.10.0",
    "@typescript-eslint/parser": "^7.0.0",
    "eslint": "^8.56.0",
    "eslint-plugin-n8n-nodes-base": "^1.16.0",
    "gulp": "^4.0.2",
    "n8n-workflow": "^1.0.0",
    "prettier": "^3.0.0",
    "typescript": "^5.3.0"
  }
}
```

---

## Build Commands

```bash
# Install dependencies
npm install --legacy-peer-deps

# Build the node
npm run build

# Watch mode (development)
npm run dev

# Lint
npm run lint

# Format code
npm run format
```

---

## Installation in n8n

```bash
# After successful build:

# 1. Link the package globally
cd /path/to/ryze-automation-router
npm link

# 2. Link to n8n
cd ~/.n8n/custom
npm link @ryze-beyond/n8n-nodes-automation-router

# 3. Restart n8n
n8n start

# Node should appear in n8n UI under "Ryze Automation Router"
```

---

## Expected Workflow Impact

### Before (Current State)
```
25-30 nodes per workflow:
- Triggers (2)
- Set Run Mode (1)
- Fetcher (3)
- Translator (4)
- Processors (5-10)
- IF Monthly Checks (2)
- Prepare S3 Data (2)
- Upload S3 (2)
- IF NOT Monthly (1)
- Deduplication Block (6)
- Done (1)
```

### After (With Custom Node)
```
10-12 nodes per workflow:
- Triggers (2)
- Fetcher (3)
- Translator (4)
- Processors (5-10)
- Ryze Automation Router (1) ← Replaces 15+ nodes!
- Done (1)
```

**Savings:** ~60% fewer nodes per workflow  
**Across 400 workflows:** ~6,000 nodes eliminated  
**Maintenance:** Update 1 node vs 400 workflows

---

## Support Information

**Developer:** Ohad Cohen  
**Company:** Ryze Beyond  
**System:** n8n workflow automation  
**Purpose:** Affiliate marketing data processing  
**Scale:** 400+ scraper workflows  

---

## Instructions for AI Assistant

When helping with this project:

1. **Focus on fixing the 5 TypeScript errors first**
2. **Maintain the existing architecture** (don't refactor the approach)
3. **Keep method signatures as-is** (context parameter pattern is correct)
4. **Preserve multi-brand support** (grouping by io_id is essential)
5. **Test suggestions should be practical** (can run in the actual environment)
6. **Output schemas must remain unchanged** (other systems depend on them)
7. **Don't simplify the dry run logic** (it's a critical feature)

The node is 95% complete - just needs the TypeScript compilation issues resolved.

---

## Quick Start for New Assistant

```bash
# Check current state
cd ryze-automation-router
npm run build

# Should see 5 errors
# Fix them in: nodes/RyzeAutomationRouter/RyzeAutomationRouter.node.ts

# After fixes:
npm run build  # Should compile successfully
ls dist/       # Verify output files exist
```

Good luck! 🚀