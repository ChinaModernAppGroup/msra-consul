# iAppLX MSRA for consul

This iApp is an example of MSRA for consul, including an audit processor.  

## Build (requires rpmbuild)

    $ npm run build

Build output is an RPM package
## Using IAppLX from BIG-IP UI
If you are using BIG-IP, install f5-iapplx-msra-consul RPM package using iApps->Package Management LX->Import screen. To create an application, use iApps-> Templates LX -> Application Services -> Applications LX -> Create screen. Default IApp LX UI will be rendered based on the input properties specified in basic pool IAppLX.

## Using IAppLX from Container to configure BIG-IP [coming soon]

Using the REST API to work with BIG-IP with f5-iapplx-msra-consul IAppLX package installed. 

Create an Application LX block with all inputProperties as shown below.
Save the JSON to block.json and use it in the curl call. Refer to the clouddoc link for more detail: https://clouddocs.f5.com/products/iapp/iapp-lx/tmos-14_0/iapplx_ops_tutorials/creating_iappslx_with_rest.html .

```json
{
  "name": "msraconsul",
  "inputProperties": [
    {
      "id": "consulEndpoint",
      "type": "STRING",
      "value": "http://1.1.1.1:8500",
      "metaData": {
        "description": "consul endpoint address",
        "displayName": "consul endpoints",
        "isRequired": true
      }
    },
    {
      "id": "node",
      "type": "STRING",
      "value": "bigip249",
      "metaData": {
        "description": "Node name to be registered in consul server",
        "displayName": "Node name in consul server",
        "isRequired": true
      }
    },
    {
      "id": "nodeIpAddr",
      "type": "STRING",
      "value": "10.1.10.249",
      "metaData": {
        "description": "Node IP address to be registered",
        "displayName": "Node IP Address",
        "isRequired": true
      }
    },
    {
      "id": "serviceName",
      "type": "STRING",
      "value": "msra-service166-onf5",
      "metaData": {
        "description": "Service name to be registered, virtual server name in F5",
        "displayName": "Service Name",
        "isRequired": true
      }
    },
    {
      "id": "serviceIpAddr",
      "type": "STRING",
      "value": "10.1.10.166",
      "metaData": {
        "description": "Service IP address to be registered",
        "displayName": "IP address",
        "isRequired": true
      }
    },
    {
      "id": "servicePort",
      "type": "NUMBER",
      "value": 8080,
      "metaData": {
        "description": "Service port to be registered",
        "displayName": "Service Port",
        "isRequired": true
      }
    }
  ],
  "dataProperties": [
    {
      "id": "pollInterval",
      "type": "NUMBER",
      "value": 30,
      "metaData": {
        "description": "Interval of polling VIP status, 30s by default.",
        "displayName": "Polling Invertal",
        "isRequired": false
      }
    }
  ],
  "configurationProcessorReference": {
    "link": "https://localhost/mgmt/shared/iapp/processors/msraconsulConfig"
  },
  "auditProcessorReference": {
    "link": "https://localhost/mgmt/shared/iapp/processors/msraconsulEnforceConfiguredAudit"
  },
  "audit": {
    "intervalSeconds": 60,
    "policy": "ENFORCE_CONFIGURED"
  },
  "configProcessorTimeoutSeconds": 30,
  "statsProcessorTimeoutSeconds": 15,
  "configProcessorAffinity": {
    "processorPolicy": "LOAD_BALANCED",
    "affinityProcessorReference": {
      "link": "https://localhost/mgmt/shared/iapp/processors/affinity/load-balanced"
    }
  },
  "state": "TEMPLATE"
}
```

Post the block through REST API using curl. 
```bash
curl -sk -X POST -d @block.json https://bigip_mgmt_ip:8443/mgmt/shared/iapp/blocks
```

