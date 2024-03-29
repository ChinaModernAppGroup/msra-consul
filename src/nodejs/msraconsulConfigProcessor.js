/*
  Copyright (c) 2017, F5 Networks, Inc.
  Licensed under the Apache License, Version 2.0 (the "License");
  you may not use this file except in compliance with the License.
  You may obtain a copy of the License at
  *
  http://www.apache.org/licenses/LICENSE-2.0
  *
  Unless required by applicable law or agreed to in writing,
  software distributed under the License is distributed on an
  "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND,
  either express or implied. See the License for the specific
  language governing permissions and limitations under the License.
  
  Updated by Ping Xiong on May/15/2022.
  Updated by Ping Xiong on Jul/2/2022, using global var for polling signal.
  Updated by Ping Xiong on Oct/05/2022, modify the polling signal into a json object to keep more information.
  let blockInstance = {
    name: "instanceName", // a block instance of the iapplx config
    state: "polling", // can be "polling" for normal running state; "update" to modify the iapplx config
    serviceId: "inputNodeName + ":" + inputVirtualServer + ":" + inputServiceName", what's the ID for consul?
  }
*/

'use strict';

// Middleware. May not be installed.
var configTaskUtil = require("./configTaskUtil");
var blockUtil = require("./blockUtils");
var logger = require('f5-logger').getInstance();
var mytmsh = require('./TmshUtil');
const fetch = require('node-fetch');
const Bluebird = require('bluebird');
fetch.Promise = Bluebird;

//var EventEmitter = require('events').EventEmitter;
//var stopPollingEvent = new EventEmitter(); 


// Setup a polling signal for audit.
//var fs = require('fs');
//const msraconsulOnPollingSignal = '/var/tmp/msraconsulOnPolling';
global.msraconsulOnPolling = [];


//const pollInterval = 10000; // Interval for polling Registry registry.
//var stopPolling = false;

/**
 * A dynamic config processor for managing LTM pools.
 * Note that the pool member name is not visible in the GUI. It is generated by MCP according to a pattern, we don't want
 * the user setting it
 *
 * @constructor
 */
function msraconsulConfigProcessor() {
}

msraconsulConfigProcessor.prototype.setModuleDependencies = function (options) {
    logger.info("setModuleDependencies called");
    configTaskUtil = options.configTaskUtil;
};

msraconsulConfigProcessor.prototype.WORKER_URI_PATH = "shared/iapp/processors/msraconsulConfig";

msraconsulConfigProcessor.prototype.onStart = function (success) {
    logger.fine("MSRA: OnStart, msraconsulConfigProcessor.prototype.onStart");
    this.apiStatus = this.API_STATUS.INTERNAL_ONLY;
    this.isPublic = true;

    configTaskUtil.initialize({
        restOperationFactory: this.restOperationFactory,
        eventChannel: this.eventChannel,
        restHelper: this.restHelper
    });

    success();
};


/**
 * Handles initial configuration or changed configuration. Sets the block to 'BOUND' on success
 * or 'ERROR' on failure. The routine is resilient in that it will try its best and always go
 * for the 'replace' all attitude.
 *
 * @param restOperation - originating rest operation that triggered this processor
 */
msraconsulConfigProcessor.prototype.onPost = function (restOperation) {
    var configTaskState,
        blockState,
        oThis = this;
    logger.fine("MSRA: onPost, msraconsulConfigProcessor.prototype.onPost");

    var instanceName;
    var inputProperties;
    var dataProperties;
    try {
        configTaskState =
        configTaskUtil.getAndValidateConfigTaskState(restOperation);
        blockState = configTaskState.block;
        logger.fine("MSRA: onPost, inputProperties ", blockState.inputProperties);
        logger.fine("MSRA: onPost, dataProperties ", blockState.dataProperties);
        logger.fine("MSRA: onPost, instanceName ", blockState.name);
        inputProperties = blockUtil.getMapFromPropertiesAndValidate(
        blockState.inputProperties,
        [
            "consulEndpoint",
            "node",
            "nodeIpAddr",
            "virtualServer",
            "serviceName",
            "serviceIpAddr",
            "servicePort"
        ]
        );
        dataProperties = blockUtil.getMapFromPropertiesAndValidate(
        blockState.dataProperties,
        ["pollInterval"]
        );
        instanceName = blockState.name;
    } catch (ex) {
        restOperation.fail(ex);
        return;
    }

    // Mark that the request meets all validity checks and tell the originator it was accepted.
    this.completeRequest(restOperation, this.wellKnownPorts.STATUS_ACCEPTED);

    // Generic URI components, minus the 'path'
    var uri = this.restHelper.buildUri({
        protocol: this.wellKnownPorts.DEFAULT_HTTP_SCHEME,
        port: this.wellKnownPorts.DEFAULT_JAVA_SERVER_PORT,
        hostname: "localhost"
    });

    //Accept input proterties, set the status to BOUND.

    const inputEndPoint = inputProperties.consulEndpoint.value;
    const inputNodeName = inputProperties.node.value;
    const inputNodeIpAddr = inputProperties.nodeIpAddr.value;
    const inputVirtualServer = inputProperties.virtualServer.value;
    const inputServiceName = inputProperties.serviceName.value;
    const inputServiceIpAddr = inputProperties.serviceIpAddr.value;
    const inputServicePort = inputProperties.servicePort.value;
    const serviceId =
        inputNodeName + ":" + inputVirtualServer + ":" + inputServiceName;
    var pollInterval = dataProperties.pollInterval.value * 1000;

    // Set the polling interval
    if (pollInterval) {
        if (pollInterval < 10000) {
        logger.fine(
            "MSRA: onPost, " +
            instanceName +
            " pollInternal is too short, will set it to 10s ",
            pollInterval
        );
        pollInterval = 10000;
        }
    } else {
        logger.fine(
        "MSRA: onPost, " +
            instanceName +
            " pollInternal is not set, will set it to 30s ",
        pollInterval
        );
        pollInterval = 30000;
    }

    // Setup the polling signal for audit and update
    // update on Oct/05/2022, using json object for polling signal, by Ping Xiong.

    let blockInstance = {
        name: instanceName,
        serviceId: serviceId,
        state: "polling",
    };

    let signalIndex = global.msraconsulOnPolling.findIndex(
        (instance) => instance.name === instanceName
    );

    if (signalIndex !== -1) {
        // Already has the instance, change the state into "update"
        global.msraconsulOnPolling.splice(signalIndex, 1);
        blockInstance.state = "update";
    }
    logger.fine(
        "MSRA: onPost, " + instanceName + " blockInstance:",
        blockInstance
    );

    // Setup a signal to identify existing polling loop
    var existingPollingLoop = false;

    // check if there is an conflict serviceId running in configuration
    if (
        global.msraconsulOnPolling.some(
        (instance) => instance.serviceId === serviceId
        )
    ) {
        logger.fine(
            "MSRA: onPost, " +
            instanceName +
            " already has an instance polling the same serviceId, change BLOCK to ERROR: ",
            serviceId
        );
        try {
            throw new Error(
                "onPost: serviceId conflict: " +
                serviceId +
                " , will set the BLOCK to ERROR state"
            );
        } catch (error) {
            configTaskUtil.sendPatchToErrorState(
                configTaskState,
                error,
                oThis.getUri().href,
                restOperation.getBasicAuthorization()
            );
        }
        return;
    } else {
        global.msraconsulOnPolling.push(blockInstance);
        logger.fine(
          "MSRA onPost: " + instanceName + " set msraconsulOnpolling signal: ",
          global.msraconsulOnPolling
        );
    }

    logger.fine(
        "MSRA: onPost, " +
        instanceName +
        " Input properties accepted, change to BOUND status, start to poll Registry for: " +
        serviceId
    );

    configTaskUtil.sendPatchToBoundState(
        configTaskState,
        oThis.getUri().href,
        restOperation.getBasicAuthorization()
    );

    // A internal service to register application to consul server.

    logger.fine(
      "MSRA: onPost, " + instanceName + " registry endpoints: " + inputEndPoint
    );

    // Prepare the service body
    const serviceBody = {
        Node: inputNodeName,
        Address: inputNodeIpAddr,
        Service: {
        Service: inputServiceName,
        ID: serviceId,
        Address: inputServiceIpAddr,
        Port: inputServicePort,
        },
    };

    // connect to consul registry to retrieve end-points.
    const registerUrl = inputEndPoint + "/v1/catalog/register";
    const deregisterUrl = inputEndPoint + "/v1/catalog/deregister";
    const listServiceUrl =
        inputEndPoint + "/v1/catalog/service/" + inputServiceName;

    //deregister a service

    function deregisterService(nodeName, serviceID) {
        fetch(deregisterUrl, {
        method: "PUT",
        body: JSON.stringify({
            Node: nodeName,
            ServiceID: serviceID,
        }),
        headers: { "Content-Type": "application/json" },
        })
        .then(function (res) {
            if (res.ok) {
            // res.status >= 200 && res.status < 300
            logger.fine("Deregister the service: " + serviceID, res.statusText);
            } else {
            logger.fine(
                "Failed to deregister the service: " + serviceID,
                res.statusText
            );
            }
        })
        .catch((err) => console.error(err));
    }

    (function schedule() {
        var pollRegistry = setTimeout(function () {

            // If signal state is "update", change it into "polling" for new polling loop
            if (
                global.msraconsulOnPolling.some(
                    (instance) => instance.name === instanceName
                )
            ) {
                let signalIndex = global.msraconsulOnPolling.findIndex(
                    (instance) => instance.name === instanceName
                );
                if (global.msraconsulOnPolling[signalIndex].state === "update") {
                    if (existingPollingLoop) {
                        logger.fine(
                            "MSRA: onPost/polling, " +
                            instanceName +
                            " update config, existing polling loop."
                    );
                    } else {
                        //logger.fine("MSRA: onPost/polling, " + instanceName + " update config, a new polling loop.");
                        global.msraconsulOnPolling[signalIndex].state = "polling";
                        logger.fine(
                            "MSRA: onPost/polling, " +
                            instanceName +
                            " update the signal.state into polling for new polling loop: ",
                            global.msraconsulOnPolling[signalIndex]
                        );
                    }
                }
                // update the existingPollingLoop to true
                existingPollingLoop = true;
            } else {
                // Non-exist instance, will NOT proceed to poll the registry
                // deregister an service from consul
                deregisterService(inputNodeName, serviceId);
                return logger.fine(
                    "MSRA: onPost/polling, " +
                    instanceName +
                    " Stop polling registry for: " +
                    serviceId
                );
            }

            // polling the registry ...

            fetch(listServiceUrl, { headers: { Accept: "application/json" } })
                .then((res) => res.json())
                .then(function (jsondata) {
                    //let nodeAddress = []; // don't care the nodeAddress anymore.
                    logger.fine(
                        "MSRA: onPost, " +
                        instanceName +
                        " Service instances data: ",
                        jsondata
                    );
                    if (jsondata.some(instance => instance.ServiceID === serviceId)) {
                        // The service already registered, check the status of F5 vs
                        // do health check for BIG-IP application, deregister if app down
                        // Use tmsh to check vs status of BIG-IP application instead of restful API
                        // Start with check the exisitence of the given pool
                        logger.fine(
                            "MSRA: onPost, " +
                            instanceName +
                            " Service found, will check the status of vs, then decide UNregister it or not."
                        );
                        mytmsh.executeCommand("tmsh -a show ltm virtual " + inputVirtualServer + " field-fmt")
                          .then(function (res) {
                            logger.fine(
                                "MSRA: onPost, " +
                                instanceName +
                                " Found the virtual server in F5, will check the availability: " +
                                inputVirtualServer
                            );
                            if (
                                res.indexOf(
                                    "status.availability-state available"
                                ) >= 0
                            ) {
                                logger.fine(
                                    "MSRA: onPost, " +
                                    instanceName +
                                    " the virtual server in F5 is available, will do nothing: " +
                                    inputVirtualServer
                                );
                            } else {
                                logger.fine(
                                    "MSRA: onPost, " +
                                    instanceName +
                                    " the virtual server is not available, will deregister from consul server: " +
                                    inputVirtualServer
                                );
                                // deregister the service from consul
                                deregisterService(inputNodeName, serviceId);
                            }
                          })
                          // Error handling
                          .catch(function (error) {
                            if (error.message.indexOf("was not found") >= 0) {
                                logger.fine(
                                    "MSRA: onPost, " +
                                    instanceName +
                                    " virtual server not found, will deregister from consul server: " +
                                    inputVirtualServer
                                );
                                // deregister an instance from consul
                                deregisterService(inputNodeName, serviceId);
                                return;
                            }
                            logger.fine(
                                "MSRA: onPost, " +
                                instanceName +
                                " Fail to check status of the virtual server: ",
                                error.message
                            );
                            return;
                          });                        
                    } else {
                        // Service not found, will register it if the status of the vs in F5 is UP.
                        logger.fine(
                          "MSRA: onPost, " +
                            instanceName +
                            " Service not found, will check the status of vs, then decide register into consul server or not."
                        );
                        // Use tmsh to check vs status of BIG-IP application instead of restful API
                        // Start with check the exisitence of the given vs
                        mytmsh.executeCommand("tmsh -a show ltm virtual " + inputVirtualServer + " field-fmt")
                            .then(function (res) {
                                logger.fine(
                                    "MSRA: onPost, " +
                                    instanceName +
                                    " Found the virtual server in F5, will check the availability: " +
                                    inputVirtualServer
                                );
                                if (res.indexOf("status.availability-state available") >= 0) {
                                    logger.fine(
                                        "MSRA: onPost, " +
                                        instanceName +
                                        " the virtual server in F5 is available, will register it to consul server: " +
                                        inputVirtualServer
                                    );

                                    // register an instance to consul
                                    fetch(registerUrl, {
                                      method: "PUT",
                                      body: JSON.stringify(serviceBody),
                                      headers: {
                                        "Content-Type": "application/json",
                                      },
                                    })
                                      .then(function (res) {
                                        if (res.ok) {
                                            // res.status >= 200 && res.status < 300
                                            logger.fine(
                                                "MSRA: onPost, " +
                                                instanceName +
                                                " Registered the service: " +
                                                inputServiceName,
                                                res.statusText
                                            );
                                        } else {
                                            logger.fine(
                                                "MSRA: onPost, " +
                                                instanceName +
                                                " Failed to register the service: " +
                                                inputServiceName,
                                                res.statusText
                                            );
                                        }
                                      })
                                      .catch((err) =>
                                        logger.fine(
                                            "MSRA: onPost, " +
                                            instanceName +
                                            " failed to register into consul: ",
                                            err.message
                                        )
                                      );
                                } else {
                                    logger.fine(
                                        "MSRA: onPost, " +
                                        instanceName +
                                        " the virtual server in F5 is NOT available, will NOT register it to consul server: " +
                                        inputVirtualServer
                                    );
                                }
                            })
                            // Error handling
                            .catch(function (error) {
                                if (error.message.indexOf("was not found") >= 0) {
                                    logger.fine(
                                        "MSRA: onPost, " +
                                        instanceName +
                                        " virtual server not found: " +
                                        inputVirtualServer
                                    );
                                    return;
                                }
                                logger.fine(
                                    "MSRA: onPost, " +
                                    instanceName +
                                    " Fail to check status of the virtual server: ",
                                    error.message
                                );
                                return;
                            });
                    }
                }, function (err) {
                    logger.fine(
                        "MSRA: onPost, " +
                        instanceName +
                        " Fail to retrieve consul service due to: ",
                        err.message
                    );
                }
                ).catch(function (error) {
                    logger.fine(
                        "MSRA: onPost, " +
                        instanceName +
                        " Fail to retrieve consul service due to: ",
                        error.message
                    );
                }).done(function () {
                    logger.fine("MSRA: onPost/polling, " + instanceName + " finish a polling action.");
                    schedule();
                });
        }, pollInterval);

        // Stop polling while undeployment or update the config

        let stopPolling = true;

        if (global.msraconsulOnPolling.some(instance => instance.name === instanceName)) {
            let signalIndex = global.msraconsulOnPolling.findIndex(instance => instance.name === instanceName);
            if (global.msraconsulOnPolling[signalIndex].state === "polling") {
                logger.fine("MSRA: onPost, " + instanceName + " keep polling registry for: ", serviceId);
                stopPolling = false;
            } else {
                if (existingPollingLoop) {
                    logger.fine("MSRA: onPost, " + instanceName + " update config, will terminate existing polling loop.");
                } else {
                    logger.fine("MSRA: onPost, " + instanceName + " update config, will trigger a new polling loop.");
                    stopPolling = false;
                }
            }
        }


        if (stopPolling)  {
            process.nextTick(() => {
                clearTimeout(pollRegistry);
                logger.fine(
                    "MSRA: onPost/stopping, " +
                    instanceName +
                    " Stop polling registry for: " +
                    serviceId
                );
            });
            // deregister the service from consul server
            setTimeout(function () {
                // deregister an service from consul
                deregisterService(inputNodeName, serviceId);
            }, 2000);
        }
    })();
};


/**
 * Handles DELETE. The configuration must be removed, if it exists. Patch the block to 'UNBOUND' or 'ERROR'
 *
 * @param restOperation - originating rest operation that triggered this processor
 */
msraconsulConfigProcessor.prototype.onDelete = function (restOperation) {
    var configTaskState,
        blockState;
    var oThis = this;

    logger.fine(
        "MSRA: onDelete, " +
        instanceName +
        " msraconsulConfigProcessor.prototype.onDelete"
    );

    var instanceName;
    var inputProperties;
    try {
        configTaskState = configTaskUtil.getAndValidateConfigTaskState(restOperation);
        blockState = configTaskState.block;
        inputProperties = blockUtil.getMapFromPropertiesAndValidate(
          blockState.inputProperties,
          ["consulEndpoint", "node", "serviceName"]
        );
        instanceName = blockState.name;
    } catch (ex) {
        restOperation.fail(ex);
        return;
    }

    //const serviceID = inputProperties.node.value + ":" + inputProperties.serviceName.value;

    this.completeRequest(restOperation, this.wellKnownPorts.STATUS_ACCEPTED);

    // Generic URI components, minus the 'path'
    var uri = this.restHelper.buildUri({
        protocol: this.wellKnownPorts.DEFAULT_HTTP_SCHEME,
        port: this.wellKnownPorts.DEFAULT_JAVA_SERVER_PORT,
        hostname: "localhost"
    });

    //Accept input proterties, set the status to BOUND.
    
    // change the state to UNBOUND
    
    configTaskUtil.sendPatchToUnBoundState(configTaskState, 
                oThis.getUri().href, restOperation.getBasicAuthorization());
    
    // Stop polling registry while undeploy ??
    // Delete the polling signal
    let signalIndex = global.msraconsulOnPolling.findIndex(
      (instance) => instance.name === instanceName
    );
    global.msraconsulOnPolling.splice(signalIndex,1);
    logger.fine(
        "MSRA: onDelete, " +
        instanceName +
        " Stop polling Registry while ondelete action."
    );
};

module.exports = msraconsulConfigProcessor;
