#!/usr/bin/env node

/*
  Copyright (C) 2018 - 2019 HERE Europe B.V.
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

import * as common from './common';

import * as fs from "fs";

import * as program from 'commander';

import {getSpaceDataFromXyz, uploadToXyzSpace, handleError, execute, createSpace, getStatisticsData} from "./xyzCommon";

const prompter = require('prompt');
const commands = ["list", "clone", "open", "show", "delete"];

const studioBaseURL = "https://studio.here.com";
const projectsUrl = "/project-api/projects";

program
    .version('0.1.0');


program
    .command("list")
    .description("information about available xyz studio projects")
    .action(async function (options) {
        listProjects(options)
            .catch((error: any) => {
                handleError(error);
            })
    });

program
    .command("delete <project-id>")
    .description("delete the project with the given id")
    .action(async (geospaceId, options) => {
        deleteProject(geospaceId, options)
            .catch((error) => {
                handleError(error, true);
            })
    });

program
    .command("show <project-id>")
    .description("open the project with the given id")
    .action(async (geospaceId, options) => {
        showProject (geospaceId)
            .catch((error) => {
                handleError(error);
            })
    });

program
    .command("clone <project-id>")
    .description("clone a project with the given id or viewer-url")
    .action(async (geospaceId, options) => {
        cloneProject (geospaceId, options)
            .catch((error) => {
                handleError(error);
            })
    });


// cloneProject - cloning projects for studio
// Steps :
//- Get the token from ProjectAPI and have a reference of currentUser’s token
// https://xyz.api.here.com/project-api/projects/82764d11-e84a-40f6-b477-12d8041ccdb7
//
//     - Take the spaceIDs from ProjectAPI
// - Download / save response all features from the shared space from viewer url
// https://xyz.api.here.com/hub/spaces/mOXoWyWn/search?margin=20&clip=false&clientId=viewer&access_token=AFSmufxGTfOGWwZQF11aiwA&limit=100000
//     - Repeat downloading if multiple GeospaceIDs exists
//
// - Upload the file to new existing current user’s workspace
// - Create the project for existing user
// - Optionally - Copy layer styles that exists from older project
async function cloneProject  (id : any, options: any) {

    //Extract the ID if user has passed in the Viewer URL otherwise the input will be treated as id
    if (id.startsWith("http")) {
        id = getParameterByName("project_id", id)
    }

    //- Get the token from ProjectAPI and have a reference of currentUser’s token from below ProjectAPI GET URL // GET - https://xyz.api.here.com/project-api/projects/82764d11-e84a-40f6-b477-12d8041ccdb7  / // GET - https://studio.here.com/viewer/?project_id=3a02af56-aa75-400c-b886-36aa8d046c08 //id = "3a02af56-aa75-400c-b886-36aa8d046c08"/ b4d1126a-fc12-4406-b506-692ace752d52
    let uri = "/project-api/projects/"+id;
    console.log("Cloning project : "+id);
    let cType = "";

    let response = await execute(uri, "GET", cType, "", options.token, false, false);

    response.body = JSON.parse(response.body);

    //Fetch the token from user's published project
    let publishersToken = response.body.rot;

    //Fetch current user's read only token
    let currentUsersToken = await common.verify(true);

    //Remove id attribute before post call, the new project which will be created for current user with this data
    delete response.body.id;

    let clonedProjectData = response.body;

    //Get the GeoSpace-ID(s) of all the layers from published projects
    let updatedLayersData = [];
    for (let i=0; i < clonedProjectData.layers.length; i++) {

        //Get the current layer
        let currentLayer = clonedProjectData.layers[i];

        //Check if the layer has tags eg. Building Footprints tags -> In Such cases copy the whole currentLayer as is -> Otherwise copy the space from the user
        if (currentLayer.meta
            && currentLayer.meta.tags
            && currentLayer.meta.tags.length > 0) {

            //Update the project layer as is without any modifications
            updatedLayersData.push(currentLayer)
        }
        else {

            //Download the space locally and reference the space for current user
            let geoSpaceIDToCopy = currentLayer.geospace.id;
            console.log(`\nCopying layer [${i+1}] : ${geoSpaceIDToCopy} from published project`)

            //Get the space title and description from the base space
            const url = `/hub/spaces/${geoSpaceIDToCopy}?clientId=cli`
            const response = await execute(url,"GET", "application/json", "", publishersToken);

            //Copy the contents of the space config title and description for currentUser's XYZ spaces
            let spaceConfigOptions = {
                title : response.body.title,
                message : response.body.description
            }

            //Get the original count of features to download from statistics API - getStatisticsData
            let spaceStatsData = await getStatisticsData(geoSpaceIDToCopy, publishersToken);

            //Download the GeospaceID from published project with the publisher's token -  Download the space from GET Search and save it in local temp file - https://xyz.api.here.com/hub/spaces/uLqEizJW/search
            let geoSpaceDownloadOptions = {
                token : publishersToken,
                limit : spaceStatsData.count.value // Fetch all features from base spaceID
            }
            let geoSpaceData = await getSpaceDataFromXyz(geoSpaceIDToCopy, geoSpaceDownloadOptions);

            //Check if GeoSpaceData is blank -> if yes move on to next one else create the file with that name
            if ( spaceStatsData.count.value === 0) {
                console.log("\nNo features are available to download");
                //process.exit();
            }
            else {
                let geoSpaceFileName = geoSpaceIDToCopy+".geojson";
                await fs.writeFileSync(geoSpaceFileName, JSON.stringify(geoSpaceData));
                console.log("Space '"+geoSpaceIDToCopy+"' downloaded locally")

                //Create a new space for currentUser
                let newSpaceData = await createSpace (spaceConfigOptions)
                let currentGeoSpaceID = newSpaceData.id;

                //Update the geospace id for current layer
                currentLayer.geospace.id = currentGeoSpaceID;

                let uploadOptions = {
                    title: geoSpaceFileName,
                    description: "GeoSpace created from HERE CLI",
                    file: geoSpaceFileName,
                    stream: true
                }

                //Upload it to current user's space
                await uploadToXyzSpace (currentGeoSpaceID, uploadOptions);

                //Clear cache and delete the file from temp repo
                await fs.unlinkSync(geoSpaceFileName)

                //Update the modified layer data.
                updatedLayersData.push(currentLayer)
            }
        }
    }

    //Update the layer data to cloned project - updatedLayersData
    clonedProjectData.layers = updatedLayersData;

    //Update the token for current project
    clonedProjectData.rot = currentUsersToken;

    //Create a new project under current user with the settings of published projects
    let newProjectResponse = await createProject(clonedProjectData, options);
    let newProjectBody = newProjectResponse.body;
    let clonedProjectURL = studioBaseURL+"/studio/project/"+newProjectBody.id;

    //Viewer URL - /https://studio.here.com/viewer/?project_id=b1e3a9d4-116b-407b-b99f-17fbdf48d405
    let viewerURL = studioBaseURL+"/viewer/?project_id="+newProjectBody.id
    if (newProjectResponse.statusCode == 201) {
        console.log("\n**** Successfully cloned ******")
        console.log("Project cloned in your studio account : "+clonedProjectURL)
        console.log("Viewer URL : "+viewerURL)
    }
}

/**
 * Will create an XYZ Studio project
 * @param projectData
 * @param options
 */
async function createProject (projectData:any, options:any) {
    let cType = "application/json"
    let newProjectResponse = await execute(projectsUrl, "POST", cType, projectData, options.token);

    let newProjectBody = newProjectResponse.body;
    if (newProjectResponse.statusCode == 201) {
        console.log("\nProject Created successfully")
    }
    else {
        console.log("\nProject creation failed")
        return null;
    }
    return newProjectResponse
}

//Will capture URL Query string parameters from URL
function getParameterByName (name: any, url: any) {
    if (!url) return null;
    name = name.replace(/[\[\]]/g, '\\$&');
    var regex = new RegExp('[?&]' + name + '(=([^&#]*)|&|#|$)'),
        results = regex.exec(url);
    if (!results) return null;
    if (!results[2]) return '';
    return decodeURIComponent(results[2].replace(/\+/g, ' '));
}

async function showProject (id : any) {
    const open = require("open");
    open(
        studioBaseURL+"/viewer/?project_id="+id
        , { wait: false });
}

async function deleteProject  (id : any, options: any) {
    console.log("Deleting project : "+id)

    //If project exists send a DELETE request for that projectID
    const uri = "/project-api/projects/"+id;
    const cType = "";
    let response = await execute (uri, "DELETE", cType, "", options.token);

    if (response && response.statusCode === 204) {
        console.log("Successfully deleted project.")
    }
    else {
        console.log("Unable to delete project having project-id: "+id)
    }
}


/**
 * Will fetch all projects
 * @param options
 */
async function findAllProjects (options:any) {
    try {
        const uri = "/project-api/projects";
        const cType = "";
        let response = await execute(uri, "GET", cType, "", options.token);
        return response;
    } catch (error) {
        console.log("Unable to get all project data")
        return null;
    }
}

/**
 * Will list all the projects for the given user in below format
 *
 * @param options
 */
export async function listProjects (options: any) {
    console.log("Please wait; Fetching your list of projects...")

    let response = await findAllProjects(options)
    let body = JSON.parse(response.body);
    if (response.body.length == 0) {
        console.log("No xyz projects found");
    } else {
        let fields = ["id", "title", "status"];

        //Flattened array of project JsonObjects containing info about name, id and description, add any other info later as necessary
        let extractProjectInfo: any[] = new Array();

        //Iterate through all the projects and extract meta information in extractColumns Array having JSON Objects with keys of id, name and description,
        body.map((currentProject:any) => {

            //Check whether meta info like project description and name exists for that project? - > If exists Push the meta info with id in new
            if (currentProject.hasOwnProperty("meta")) {
                let viewerURL = "";
                if (currentProject.status.toUpperCase() === "PUBLISHED") {
                    viewerURL = "https://xyz.here.com/viewer/?project_id=" + currentProject.id;
                }
                let currentProjectDetails = {
                    id: currentProject.id,
                    title: currentProject.meta.name,
                    description: currentProject.meta.description,
                    status: currentProject.status,
                    viewerURL
                }
                extractProjectInfo.push(new Object(currentProjectDetails))
            }
        })

        //List the project
        common.drawNewTable(extractProjectInfo, fields, [40, 25, 12]);
    }
}

common.validate(commands, [process.argv[2]], program);
prompter.stop();
program.parse(process.argv);
if (!program.args.length) {
    common.verify();
}
