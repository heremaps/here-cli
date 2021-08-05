#!/usr/bin/env node

/*
  Copyright (C) 2018 - 2021 HERE Europe B.V.
  SPDX-License-Identifier: MIT

  Permission is hereby granted, free of charge, to any person obtaining
  a copy of this software and associated documentation files (the
  'Software'), to deal in the Software without restriction, including
  without limitation the rights to use, copy, modify, merge, publish,
  distribute, sublicense, and/or sell copies of the Software, and to
  permit persons to whom the Software is furnished to do so, subject to
  the following conditions:

  The above copyright notice and this permission notice shall be
  included in all copies or substantial portions of the Software.

  THE SOFTWARE IS PROVIDED 'AS IS', WITHOUT WARRANTY OF ANY KIND,
  EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
  MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
  IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY
  CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT,
  TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE
  SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
*/
import * as common from "./common";
import {RequestFactory, OlpClientSettings} from "@here/olp-sdk-core";
import {ConfigApi, RequestBuilder} from "@here/olp-sdk-dataservice-api";
let requestBuilder: RequestBuilder;

async function getConfigApiRequestBuilder(token: string = ''){
    if(requestBuilder){
        return requestBuilder;
    }
    if (!token) {
        token = await common.getWorkspaceToken();
    }
    const olpClientSettings = new OlpClientSettings({
        environment: "here",
        getToken: async () => token
    });
    requestBuilder = await RequestFactory.create("config","v1",olpClientSettings);
    return requestBuilder;
}

export async function deleteLayer(catalogHrn: string, layerId: string, token: string = ''){
    const requestBuilder = await getConfigApiRequestBuilder(token);  
    const statusLink = await ConfigApi.deleteLayer(requestBuilder, {catalogHrn: catalogHrn,layerId: layerId});

    if(statusLink.configToken) {
        const statusResponse = await waitForStatus(requestBuilder, statusLink.configToken);
        if(statusResponse && statusResponse.status) {
            console.log('Layer delete for ' + layerId + ' is completed with status ' + statusResponse.status)
        } else {
            console.log(statusResponse);
        }
    }
    //TODO - check the status link for result when its completed
}

export async function createInteractiveMapLayer(catalogHrn: string, options: any, token: string = ''){  
    let catalog = await getCatalogDetails(catalogHrn, token);
    const requestBuilder = await getConfigApiRequestBuilder(token);
    let layers: any[] = catalog.layers;
    let layer = getLayerObject(options);
    layers.push(layer);
    let updateCatalogConfig: ConfigApi.CreateCatalog = {
        id : catalog.id,
        description : catalog.description,
        name : catalog.name,
        notifications : catalog.notifications,
        replication : catalog.replication,
        summary: catalog.summary,
        tags: catalog.tags,
        layers: layers
    }
    console.log(updateCatalogConfig);
    const statusLink = await ConfigApi.updateCatalog(requestBuilder, {catalogHrn: catalogHrn,body: updateCatalogConfig});
    console.log(statusLink);
    //TODO - check the status link for result when its completed
    if(statusLink.configToken) {
        const statusResponse = await waitForStatus(requestBuilder, statusLink.configToken);
        if(statusResponse && statusResponse.status) {
            console.log('Catalog update for ' + updateCatalogConfig.id + ' is completed with status ' + statusResponse.status)
        } else {
            console.log(statusResponse);
        }
    }
}

export async function updateInteractiveMapLayer(catalogHrn: string, layerId: string, options: any, token: string = ''){  
    const requestBuilder = await getConfigApiRequestBuilder(token);
    let layer = getLayerObject(options, undefined);

    const statusLink = await ConfigApi.patchLayer(requestBuilder, {catalogHrn: catalogHrn, layerId: layerId, body: layer});

    //TODO - check the status link for result when its completed
    if(statusLink.configToken) {
        const statusResponse = await waitForStatus(requestBuilder, statusLink.configToken);
        if(statusResponse && statusResponse.status) {
            console.log('Layer update for ' + layerId + ' is completed with status ' + statusResponse.status)
        } else {
            console.log(statusResponse);
        }
    }
}

export function getLayerObject(options: any, layerType: string = "interactivemap"){
    let layer = {
        id : options.id,
        name: options.layerName,
        summary: options.summary,
        description: options.message,
        layerType: layerType,
        interactiveMapProperties: {
            searchableProperties: options.searchableProperties?.split(",")
        },
        tags: options.tags?.split(","),
        billingTags: options.billingTags?.split(",")
        //hrn: catalogHrn + ":" + options.id,
    };
    return layer;
}

export async function getCatalogDetails(catalogHrn: string, token: string = ''): Promise<ConfigApi.Catalog>{
    const requestBuilder = await getConfigApiRequestBuilder(token);
    return await ConfigApi.getCatalog(requestBuilder, {catalogHrn: catalogHrn});
}

export async function getCatalogs(vebose: boolean, token: string){
    const requestBuilder = await getConfigApiRequestBuilder(token);
    const catalogListResult = await ConfigApi.getCatalogs(requestBuilder,
        {verbose:vebose});//TODO - use layer filtering once interactivemap is available in the layerType
    if(catalogListResult.results) {
        return catalogListResult.results.items;
    } else {
        return [];
    }
}

export async function createCatalog(options: any, layers: any[] = []){
    const requestBuilder = await getConfigApiRequestBuilder(options.token);
    let createCatalogConfig: ConfigApi.CreateCatalog = {
        id : options.id,
        description : options.message,
        name : options.catalogName,
        summary: options.summary,
        tags: options.tags?.split(","),
        layers: layers
    }
    const statusLink = await ConfigApi.createCatalog(requestBuilder, {body:createCatalogConfig});
    //console.log(statusLink);
    //TODO - check the status link for result when its completed
    if(statusLink.configToken) {
        const statusResponse = await waitForStatus(requestBuilder, statusLink.configToken);
        if(statusResponse && statusResponse.status) {
            console.log('Catalog creation for ' + createCatalogConfig.id + ' is completed with status ' + statusResponse.status)
        } else {
            console.log(statusResponse);
        }
    }
    
}

export async function validateCatalogAndLayer(catalogHrn: string, layerId: string, token: string = ''){
    const catalog = await getCatalogDetails(catalogHrn, token);//this verifies if catalogHrn is correct and user has access to it
    if(layerId){
        for(const layer of (catalog.layers as Array<any>)){
            if(layer.id == layerId){
                if(layer.layerType == "interactivemap"){
                    return catalog;
                } else {
                    console.error("Error - layer " + layerId + " is not of type interactivemap");
                    process.exit(1);
                }
            }
        }
        console.error("Error - layer " + layerId + " is not present in the catalog " + catalogHrn);
        process.exit(1);
    }
    return catalog;
}


async function waitForStatus(builder: RequestBuilder, configToken: string) {
    let status = 'pending', response;
    while(status === 'pending') {
        await new Promise(done => setTimeout(done, 500));
        const statusResponse = await ConfigApi.getCatalogStatus(builder, {token: configToken});
        status = statusResponse.status ? statusResponse.status : 'success';
        response = statusResponse;
    }
    return response;
}