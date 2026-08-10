import { Request, Response } from "express";

const GRAPHQL_URL = process.env.NHOST_GRAPHQL_URL;
const ADMIN_SECRET = process.env.NHOST_ADMIN_SECRET;

async function graphql(
  query: string,
  variables: Record<string, any>
) {
  if (!GRAPHQL_URL) {
    throw new Error("NHOST_GRAPHQL_URL is missing");
  }

  if (!ADMIN_SECRET) {
    throw new Error("NHOST_ADMIN_SECRET is missing");
  }

  const response = await fetch(GRAPHQL_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-hasura-admin-secret": ADMIN_SECRET,
    },
    body: JSON.stringify({
      query,
      variables,
    }),
  });

  const result = await response.json();

  if (!response.ok || result.errors) {
    console.error("GRAPHQL ERROR:", result.errors);
    throw new Error(
      result.errors?.[0]?.message || "GraphQL request failed"
    );
  }

  return result.data;
}

export default async function handler(
  req: Request,
  res: Response
) {
  try {
    console.log("=================================");
    console.log("TRIGGER WORKFLOW RUN");
    console.log("BODY:", JSON.stringify(req.body));
    console.log("HEADERS:", req.headers);
    console.log("=================================");

    const { workflow_id } = req.body || {};
    const userId =
      req.body?.session_variables?.["x-hasura-user-id"];

    if (!workflowId) {
      return res.status(400).json({
        message: "workflow_id is required",
      });
    }

    if (!userId) {
      return res.status(401).json({
        message: "Authenticated user is required",
      });
    }

    /*
     * STEP 1
     * Get workflow and its organization.
     */
    const workflowData = await graphql(
      `
        query GetWorkflow($workflow_id: uuid!) {
          workflows_by_pk(id: $workflow_id) {
            id
            org_id
            name
          }
        }
      `,
      {
        workflow_id: workflowId,
      }
    );

    const workflow = workflowData.workflows_by_pk;

    if (!workflow) {
      return res.status(404).json({
        message: "Workflow not found",
      });
    }

    /*
     * STEP 2
     * Check that the logged-in user belongs
     * to the workflow's organization.
     */
    const memberData = await graphql(
      `
        query CheckMember(
          $user_id: uuid!
          $org_id: uuid!
        ) {
          org_members(
            where: {
              user_id: { _eq: $user_id }
              org_id: { _eq: $org_id }
            }
            limit: 1
          ) {
            user_id
            org_id
            role
          }
        }
      `,
      {
        user_id: userId,
        org_id: workflow.org_id,
      }
    );

    const member = memberData.org_members?.[0];

    if (!member) {
      return res.status(403).json({
        message: "User is not a member of this organization",
      });
    }

    /*
     * STEP 3
     * Only owner/editor can trigger.
     */
    if (
      member.role !== "owner" &&
      member.role !== "editor"
    ) {
      return res.status(403).json({
        message: "Only owner/editor can run workflows",
      });
    }

    /*
     * STEP 4
     * Create workflow run.
     */
    const runData = await graphql(
      `
        mutation CreateWorkflowRun(
          $workflow_id: uuid!
          $trigger_type: String!
          $status: String!
          $created_by: uuid
        ) {
          insert_workflow_runs_one(
            object: {
              workflow_id: $workflow_id
              trigger_type: $trigger_type
              status: $status
              created_by: $created_by
            }
          ) {
            id
            workflow_id
            trigger_type
            status
          }
        }
      `,
      {
        workflow_id: workflowId,
        trigger_type: "manual",
        status: "running",
        created_by: userId,
      }
    );

    const run = runData.insert_workflow_runs_one;

    console.log("WORKFLOW RUN CREATED:", run);

    /*
     * Return to Hasura Action.
     */
    return res.status(200).json({
      id: run.id,
      status: "running",
      message: `Workflow "${workflow.name}" started successfully`,
    });
  } catch (error: any) {
    console.error("TRIGGER WORKFLOW ERROR:", error);

    return res.status(500).json({
      message: error.message || "Workflow execution failed",
    });
  }
}
