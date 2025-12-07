import {
    ICredentialType,
    INodeProperties,
} from 'n8n-workflow';

export class TrafficPointApi implements ICredentialType {
    name = 'trafficPointApi';
    displayName = 'TrafficPoint API';
    documentationUrl = 'https://docs.ryzebeyond.com/trafficpoint';
    properties: INodeProperties[] = [
        {
            displayName: 'Cookie Header',
            name: 'cookieHeader',
            type: 'string',
            typeOptions: {
                password: true,
            },
            default: '',
            placeholder: 'SES_TOKEN=...; VIEWER_TOKEN=...',
            description: 'Full cookie header for TrafficPoint authentication',
            required: true,
        },
        {
            displayName: 'Pixel URL',
            name: 'pixelUrl',
            type: 'string',
            default: 'https://pixel.trafficpointltd.com/scraper',
            description: 'TrafficPoint pixel endpoint URL',
            required: true,
        },
    ];
}