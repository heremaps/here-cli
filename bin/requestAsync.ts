import * as request from 'request';

// async wrapper around request
export function requestAsync(options: request.CoreOptions & request.UrlOptions): Promise<{ response: request.Response, body: any }>
{
    return new Promise((resolve, reject) => {
        request(options, function(err, response, body) {
            if (err)
                reject(err);
            else
                resolve({ response, body });
        });
    });
}
