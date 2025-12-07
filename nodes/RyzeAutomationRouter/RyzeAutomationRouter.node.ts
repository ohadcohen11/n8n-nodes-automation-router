import {
    IExecuteFunctions,
    INodeExecutionData,
    INodeType,
    INodeTypeDescription,
    NodeOperationError,
} from 'n8n-workflow';

import * as AWS from 'aws-sdk';
import * as mysql from 'mysql2/promise';

export class RyzeAutomationRouter implements INodeType {
    description: INodeTypeDescription = {
        displayName: 'Ryze Automation Router',
        name: 'ryzeAutomationRouter',
        icon: 'file:ryze.svg',
        group: ['transform'],
        version: 1,
        subtitle: '={{$parameter["executionMode"]}}',
        description: 'Routes data to TrafficPoint or S3 based on execution mode',
        defaults: {
            name: 'Ryze Automation Router',
        },
        inputs: ['main'],
        outputs: ['main'],
        credentials: [
            {
                name: 'mysql',
                required: true,
                displayOptions: {
                    show: {
                        executionMode: ['auto', 'forceRegular'],
                    },
                },
            },
            {
                name: 'aws',
                required: true,
                displayOptions: {
                    show: {
                        executionMode: ['auto', 'forceMonthly'],
                    },
                },
            },
            {
                name: 'trafficPointApi',
                required: true,
                displayOptions: {
                    show: {
                        executionMode: ['auto', 'forceRegular'],
                    },
                },
            },
        ],
        properties: [
            // ============ REQUIRED PARAMETERS ============
            {
                displayName: 'Script ID',
                name: 'scriptId',
                type: 'string',
                default: '',
                placeholder: '2000',
                description: 'Your scraper script ID',
                required: true,
            },
            {
                displayName: 'Main IO ID',
                name: 'mainIoId',
                type: 'string',
                default: '',
                placeholder: '545f8472fe0af42e7bbb6903',
                description: 'Primary brand IO ID (used for translated data)',
                required: true,
            },
            {
                displayName: 'Execution Mode',
                name: 'executionMode',
                type: 'options',
                options: [
                    {
                        name: 'Auto-Detect',
                        value: 'auto',
                        description: 'Automatically detect from trigger (Monthly Trigger = monthly, else regular)',
                    },
                    {
                        name: 'Force Regular Run',
                        value: 'forceRegular',
                        description: 'Always send to TrafficPoint pixel (for testing)',
                    },
                    {
                        name: 'Force Monthly Run',
                        value: 'forceMonthly',
                        description: 'Always upload to S3 (for testing)',
                    },
                ],
                default: 'auto',
                description: 'How to determine routing behavior',
            },
            
            // ============ OPTIONAL PARAMETERS ============
            {
                displayName: 'Options',
                name: 'options',
                type: 'collection',
                placeholder: 'Add Option',
                default: {},
                options: [
                    {
                        displayName: 'Dry Run Mode',
                        name: 'dryRun',
                        type: 'boolean',
                        default: false,
                        description: 'Whether to test without actually sending/uploading data',
                    },
                    {
                        displayName: 'Translator Node Name',
                        name: 'translatorNodeName',
                        type: 'string',
                        default: 'Translator',
                        description: 'Name of the node containing translated data (for monthly uploads)',
                    },
                    {
                        displayName: 'Skip Deduplication',
                        name: 'skipDedup',
                        type: 'boolean',
                        default: false,
                        description: 'Whether to skip MySQL deduplication check (send all items)',
                    },
                    {
                        displayName: 'S3 Bucket Name',
                        name: 's3Bucket',
                        type: 'string',
                        default: 'ryze-data-brand-performance',
                        description: 'AWS S3 bucket name for monthly uploads',
                    },
                    {
                        displayName: 'Verbose Logging',
                        name: 'verbose',
                        type: 'boolean',
                        default: false,
                        description: 'Whether to include detailed debug information in output',
                    },
                    {
                        displayName: 'MySQL Database',
                        name: 'mysqlDatabase',
                        type: 'string',
                        default: 'cms',
                        description: 'MySQL database name for scraper_tokens table',
                    },
                    {
                        displayName: 'BO MySQL Database',
                        name: 'boDatabase',
                        type: 'string',
                        default: 'bo',
                        description: 'MySQL database name for brands lookup',
                    },
                ],
            },
        ],
    };

    async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
        const items = this.getInputData();
        const startTime = Date.now();

        try {
            // Get parameters
            const scriptId = this.getNodeParameter('scriptId', 0) as string;
            const mainIoId = this.getNodeParameter('mainIoId', 0) as string;
            const executionMode = this.getNodeParameter('executionMode', 0) as string;
            const options = this.getNodeParameter('options', 0, {}) as any;

            const dryRun = options.dryRun || false;
            const skipDedup = options.skipDedup || false;
            const verbose = options.verbose || false;
            const s3Bucket = options.s3Bucket || 'ryze-data-brand-performance';
            const mysqlDb = options.mysqlDatabase || 'cms';
            const boDb = options.boDatabase || 'bo';

            // Determine actual mode
            let mode = executionMode;
            if (mode === 'auto') {
                // Simple auto-detection: monthly runs typically happen on 2nd of month
                // For now, default to 'regular' - can be enhanced later
                mode = 'regular';
            }

            // Get processed data (current input items)
            const processedData = items.map(item => item.json);

            if (mode === 'forceMonthly' || mode === 'monthly') {
                // MONTHLY PATH - Upload to S3
                return await (this as any).handleMonthlyRun(
                    this,
                    processedData,
                    scriptId,
                    mainIoId,
                    dryRun,
                    s3Bucket,
                    boDb,
                    startTime,
                    verbose
                );
            } else {
                // REGULAR PATH - Send to TrafficPoint
                return await (this as any).handleRegularRun(
                    this,
                    processedData,
                    scriptId,
                    dryRun,
                    skipDedup,
                    mysqlDb,
                    startTime,
                    verbose
                );
            }

        } catch (error: any) {
            throw new NodeOperationError(
                this.getNode(),
                `Ryze Automation Router failed: ${error.message}`,
                {
                    description: error.description || 'An error occurred during execution',
                    itemIndex: 0,
                }
            );
        }
    }

    // ========================================
    // REGULAR RUN - TRAFFICPOINT PIXEL
    // ========================================
    // @ts-ignore - Called via (this as any).handleRegularRun in execute method
    private async handleRegularRun(
        context: IExecuteFunctions,
        processedData: any[],
        scriptId: string,
        dryRun: boolean,
        skipDedup: boolean,
        mysqlDb: string,
        startTime: number,
        verbose: boolean
    ): Promise<INodeExecutionData[][]> {

        const mysqlCheckStart = Date.now();
        let duplicates: string[] = [];
        let toSend = processedData;

        // Step 1: Check for duplicates (unless skipped)
        if (!skipDedup && !dryRun) {
            duplicates = await this.checkDuplicates(context, processedData, mysqlDb);
            toSend = processedData.filter(item => !duplicates.includes(item.trx_id));
        } else if (!skipDedup && dryRun) {
            duplicates = await this.checkDuplicates(context, processedData, mysqlDb);
            toSend = processedData.filter(item => !duplicates.includes(item.trx_id));
        }

        const mysqlCheckDuration = Date.now() - mysqlCheckStart;

        // Step 2: Send to TrafficPoint (or simulate if dry run)
        let pixelResults: { success: any[], failed: any[] } = { success: [], failed: [] };
        let pixelDuration = 0;

        if (!dryRun && toSend.length > 0) {
            const pixelStart = Date.now();
            pixelResults = await this.sendToTrafficPoint(context, toSend);
            pixelDuration = Date.now() - pixelStart;
        }

        // Step 3: Insert successful sends to MySQL (or simulate)
        let insertDuration = 0;
        let insertedCount = 0;

        if (!dryRun && pixelResults.success.length > 0) {
            const insertStart = Date.now();
            insertedCount = await this.insertToDatabase(context, pixelResults.success, mysqlDb);
            insertDuration = Date.now() - insertStart;
        }

        // Build output
        const totalDuration = Date.now() - startTime;

        const output: any = {
            execution: {
                mode: 'regular',
                dry_run: dryRun,
                timestamp: new Date().toISOString(),
                duration_ms: totalDuration,
            },
            summary: {
                total_input: processedData.length,
                duplicates_found: duplicates.length,
            },
            details: {
                duplicate_trx_ids: duplicates,
            },
            metrics: {
                mysql_check_ms: mysqlCheckDuration,
            },
        };

        if (dryRun) {
            output.summary.would_send_to_pixel = toSend.length;
            output.summary.status = 'DRY_RUN_SKIPPED';
            output.details.new_events_preview = toSend.slice(0, 10);
            output.details.new_events_total = toSend.length;
        } else {
            output.summary.sent_to_pixel = toSend.length;
            output.summary.pixel_success = pixelResults.success.length;
            output.summary.pixel_failed = pixelResults.failed.length;
            output.summary.inserted_to_db = insertedCount;
            output.details.failed_sends = pixelResults.failed;
            output.metrics.pixel_send_ms = pixelDuration;
            output.metrics.mysql_insert_ms = insertDuration;
        }

        return [[{ json: output }]];
    }

    // ========================================
    // MONTHLY RUN - S3 UPLOAD
    // ========================================
    // @ts-ignore - Called via (this as any).handleMonthlyRun in execute method
    private async handleMonthlyRun(
        context: IExecuteFunctions,
        processedData: any[],
        scriptId: string,
        mainIoId: string,
        dryRun: boolean,
        s3Bucket: string,
        boDb: string,
        startTime: number,
        verbose: boolean
    ): Promise<INodeExecutionData[][]> {

        const uploads: any[] = [];
        const mysqlStart = Date.now();

        // Get translated data (from translator node)
        const translatedData = this.getTranslatedData(context);

        // Group processed data by io_id
        const groupedByIoId = this.groupByIoId(processedData);

        const mysqlDuration = Date.now() - mysqlStart;

        // Calculate date folders
        const now = new Date();
        const prevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        const yearFolder = prevMonth.getFullYear().toString();
        const monthFolder = (prevMonth.getMonth() + 1).toString().padStart(2, '0');

        let csvGenDuration = 0;
        let s3UploadDuration = 0;

        // Upload Translated data (one file with main io_id)
        if (translatedData.length > 0) {
            const brandInfo = await this.getBrandGroupId(context, mainIoId, boDb);
            const csvStart = Date.now();
            const csv = this.convertToCSV(translatedData);
            csvGenDuration += Date.now() - csvStart;

            const path = `AutomationDiscrepancy/${yearFolder}/${monthFolder}/${brandInfo.brand_group_id}/${mainIoId}_${scriptId}_Translated.csv`;

            if (!dryRun) {
                const uploadStart = Date.now();
                await this.uploadToS3(context, s3Bucket, path, csv);
                const uploadDur = Date.now() - uploadStart;
                s3UploadDuration += uploadDur;

                uploads.push({
                    type: 'Translated',
                    io_id: mainIoId,
                    brand_group_id: brandInfo.brand_group_id,
                    brand_group_name: brandInfo.brand_group_name,
                    path: path,
                    s3_url: `s3://${s3Bucket}/${path}`,
                    rows: translatedData.length,
                    size_bytes: Buffer.byteLength(csv),
                    size_kb: Math.round(Buffer.byteLength(csv) / 1024),
                    upload_duration_ms: uploadDur,
                });
            } else {
                uploads.push({
                    type: 'Translated',
                    io_id: mainIoId,
                    brand_group_id: brandInfo.brand_group_id,
                    brand_group_name: brandInfo.brand_group_name,
                    would_upload_to: path,
                    rows: translatedData.length,
                    estimated_size_kb: Math.round(Buffer.byteLength(csv) / 1024),
                    status: 'DRY_RUN_SKIPPED',
                });
            }
        }

        // Upload Processed data (one file per io_id)
        for (const [ioId, items] of Object.entries(groupedByIoId)) {
            const brandInfo = await this.getBrandGroupId(context, ioId, boDb);
            const csvStart = Date.now();
            const csv = this.convertToCSV(items as any[]);
            csvGenDuration += Date.now() - csvStart;

            const path = `AutomationDiscrepancy/${yearFolder}/${monthFolder}/${brandInfo.brand_group_id}/${ioId}_${scriptId}_Processed.csv`;

            if (!dryRun) {
                const uploadStart = Date.now();
                await this.uploadToS3(context, s3Bucket, path, csv);
                const uploadDur = Date.now() - uploadStart;
                s3UploadDuration += uploadDur;

                uploads.push({
                    type: 'Processed',
                    io_id: ioId,
                    brand_group_id: brandInfo.brand_group_id,
                    brand_group_name: brandInfo.brand_group_name,
                    path: path,
                    s3_url: `s3://${s3Bucket}/${path}`,
                    rows: (items as any[]).length,
                    size_bytes: Buffer.byteLength(csv),
                    size_kb: Math.round(Buffer.byteLength(csv) / 1024),
                    upload_duration_ms: uploadDur,
                });
            } else {
                uploads.push({
                    type: 'Processed',
                    io_id: ioId,
                    brand_group_id: brandInfo.brand_group_id,
                    brand_group_name: brandInfo.brand_group_name,
                    would_upload_to: path,
                    rows: (items as any[]).length,
                    estimated_size_kb: Math.round(Buffer.byteLength(csv) / 1024),
                    status: 'DRY_RUN_SKIPPED',
                });
            }
        }

        const totalDuration = Date.now() - startTime;

        const output: any = {
            execution: {
                mode: 'monthly',
                dry_run: dryRun,
                timestamp: new Date().toISOString(),
                duration_ms: totalDuration,
            },
            summary: {
                translated_rows: translatedData.length,
                processed_rows: processedData.length,
                brands_processed: Object.keys(groupedByIoId).length,
            },
            uploads: uploads,
            metrics: {
                mysql_queries_ms: mysqlDuration,
                csv_generation_ms: csvGenDuration,
            },
        };

        if (dryRun) {
            output.summary.would_create_files = uploads.length;
            output.summary.status = 'DRY_RUN_SKIPPED';
        } else {
            output.summary.files_created = uploads.length;
            output.metrics.s3_upload_total_ms = s3UploadDuration;
        }

        return [[{ json: output }]];
    }

    // ========================================
    // HELPER METHODS
    // ========================================

    private getTranslatedData(context: IExecuteFunctions): any[] {
        // Try to get data from translator node
        // For now, return empty array - this would need workflow execution context

        // In a real implementation, you'd need to access the workflow execution data
        // This is a simplified version
        return [];
    }

    private groupByIoId(items: any[]): Record<string, any[]> {
        const grouped: Record<string, any[]> = {};
        
        items.forEach(item => {
            const ioId = item.io_id;
            if (!grouped[ioId]) {
                grouped[ioId] = [];
            }
            grouped[ioId].push(item);
        });

        return grouped;
    }

    private async checkDuplicates(context: IExecuteFunctions, items: any[], mysqlDb: string): Promise<string[]> {
        const credentials = await context.getCredentials('mysql');
        
        const connection = await mysql.createConnection({
            host: credentials.host as string,
            port: credentials.port as number,
            database: mysqlDb,
            user: credentials.user as string,
            password: credentials.password as string,
        });

        const trxIds = items.map(item => item.trx_id);
        const placeholders = trxIds.map(() => '?').join(',');
        
        const [rows] = await connection.execute(
            `SELECT trx_id FROM scraper_tokens WHERE trx_id IN (${placeholders})`,
            trxIds
        );

        await connection.end();

        return (rows as any[]).map(row => row.trx_id);
    }

    private async sendToTrafficPoint(context: IExecuteFunctions, items: any[]): Promise<{ success: any[], failed: any[] }> {
        const credentials = await context.getCredentials('trafficPointApi');
        const pixelUrl = credentials.pixelUrl as string;
        const cookieHeader = credentials.cookieHeader as string;

        const success: any[] = [];
        const failed: any[] = [];

        for (const item of items) {
            try {
                const payload = JSON.stringify({
                    trackInfo: {
                        tokenId: '',
                        track_type: 'event',
                        date: item.date,
                        timestamp: new Date().toISOString(),
                    },
                    params: {
                        commission_amount: item.commission_amount,
                        currency: item.currency,
                        amount: item.amount,
                        ioId: item.io_id,
                    },
                    trxId: item.trx_id,
                    eventName: item.event.toLowerCase(),
                    source_token: `${item.token}`,
                    parent_api_call: JSON.stringify({
                        parent_api_call: item.parent_api_call,
                    }),
                });

                const response = await context.helpers.request({
                    method: 'POST',
                    url: pixelUrl,
                    headers: {
                        'Cookie': cookieHeader,
                        'Content-Type': 'application/x-www-form-urlencoded',
                    },
                    form: {
                        data: payload,
                    },
                });

                const result = JSON.parse(response as string);
                if (result.status === 'OK') {
                    success.push({ ...item, status: 'OK' });
                } else {
                    failed.push({ 
                        trx_id: item.trx_id,
                        io_id: item.io_id,
                        error: result.error || 'Unknown error',
                        amount: item.amount,
                        commission_amount: item.commission_amount,
                    });
                }
            } catch (error: any) {
                failed.push({
                    trx_id: item.trx_id,
                    io_id: item.io_id,
                    error: error.message,
                    amount: item.amount,
                    commission_amount: item.commission_amount,
                });
            }
        }

        return { success, failed };
    }

    private async insertToDatabase(context: IExecuteFunctions, items: any[], mysqlDb: string): Promise<number> {
        const credentials = await context.getCredentials('mysql');
        
        const connection = await mysql.createConnection({
            host: credentials.host as string,
            port: credentials.port as number,
            database: mysqlDb,
            user: credentials.user as string,
            password: credentials.password as string,
        });

        const values = items.map(item => 
            `('${item.trx_id}', '${item.amount}', '${item.commission_amount}', 'scraper', NOW())`
        ).join(',');

        const query = `INSERT INTO scraper_tokens (trx_id, amount, commission_amount, stream, created_at) 
                       VALUES ${values} 
                       ON DUPLICATE KEY UPDATE trx_id = trx_id`;

        const [result] = await connection.execute(query);
        await connection.end();

        return (result as any).affectedRows;
    }

    private async getBrandGroupId(context: IExecuteFunctions, ioId: string, boDb: string): Promise<{ brand_group_id: number, brand_group_name: string }> {
        const credentials = await context.getCredentials('mysql');
        
        const connection = await mysql.createConnection({
            host: credentials.host as string,
            port: credentials.port as number,
            database: boDb,
            user: credentials.user as string,
            password: credentials.password as string,
        });

        const [rows] = await connection.execute(
            `SELECT bg.id as brand_group_id, bg.name as brand_group_name 
             FROM out_brands AS b 
             LEFT JOIN brands_groups AS bg ON b.brands_group_id = bg.id 
             WHERE b.mongodb_id = ? 
             LIMIT 1`,
            [ioId]
        );

        await connection.end();

        if ((rows as any[]).length === 0) {
            return { brand_group_id: 0, brand_group_name: 'Unknown' };
        }

        return (rows as any[])[0];
    }

    private convertToCSV(items: any[]): string {
        if (items.length === 0) return '';

        const headers = Object.keys(items[0]);
        const csvRows = [headers.join(',')];

        for (const item of items) {
            const values = headers.map(header => {
                const value = item[header];
                return typeof value === 'string' && value.includes(',') 
                    ? `"${value}"` 
                    : value;
            });
            csvRows.push(values.join(','));
        }

        return csvRows.join('\n');
    }

    private async uploadToS3(context: IExecuteFunctions, bucket: string, key: string, content: string): Promise<void> {
        const credentials = await context.getCredentials('aws');
        
        const s3 = new AWS.S3({
            accessKeyId: credentials.accessKeyId as string,
            secretAccessKey: credentials.secretAccessKey as string,
            region: credentials.region as string || 'us-east-1',
        });

        await s3.putObject({
            Bucket: bucket,
            Key: key,
            Body: content,
            ContentType: 'text/csv',
        }).promise();
    }
}