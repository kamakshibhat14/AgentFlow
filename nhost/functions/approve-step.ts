import { Request, Response } from "express";

const GRAPHQL_URL = process.env.NHOST_GRAPHQL_URL;
const ADMIN_SECRET = process.env.NHOST_ADMIN_SECRET;

type Variables = Record<string, any>;

async function graphql(
  query: string,
  variables: Variables
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
      "x-hasura-admin-secret": ADMIN_SECRET
    },
    body: JSON.stringify({
      query,
      variables
    })
  });

  const text = await response.text();

  let result: any;

  try {
    result = JSON.parse(text);
  } catch {
    throw new Error(`Invalid GraphQL response: ${text}`);
  }

  if (!response.ok || result.errors) {
    throw new Error(
      result.errors?.[0]?.message ||
        "GraphQL request failed"
    );
  }

  return result.data;
}

export default async function handler(
  req: Request,
  res: Response
) {
  try {
    console.log("========== APPROVE STEP ==========");
    console.log("BODY:", JSON.stringify(req.body));

    const stepRunId =
      req.body?.input?.step_run_id;

    const userId =
      req.body?.session_variables?.[
        "x-hasura-user-id"
      ];

    if (!stepRunId) {
      return res.status(400).json({
        id: stepRunId ?? "",
        status: "failed",
        message: "step_run_id is required"
      });
    }

    if (!userId) {
      return res.status(401).json({
        id: stepRunId,
        status: "failed",
        message: "Authenticated user is required"
      });
    }

    /*
     * 1. Find the step run
     */
    const stepRunData = await graphql(
      `
        query GetStepRun($id: uuid!) {
          step_runs_by_pk(id: $id) {
            id
            status
            workflow_run_id
            workflow_step_id
          }
        }
      `,
      {
        id: stepRunId
      }
    );

    const stepRun =
      stepRunData.step_runs_by_pk;

    if (!stepRun) {
      return res.status(404).json({
        id: stepRunId,
        status: "failed",
        message: "Step run not found"
      });
    }

    /*
     * 2. It must currently be paused
     */
    if (stepRun.status !== "paused") {
      return res.status(400).json({
        id: stepRunId,
        status: stepRun.status,
        message:
          "This step is not waiting for approval"
      });
    }

    /*
     * 3. Get workflow run
     */
    const runData = await graphql(
      `
        query GetWorkflowRun($id: uuid!) {
          workflow_runs_by_pk(id: $id) {
            id
            workflow_id
            status
          }
        }
      `,
      {
        id: stepRun.workflow_run_id
      }
    );

    const workflowRun =
      runData.workflow_runs_by_pk;

    if (!workflowRun) {
      return res.status(404).json({
        id: stepRunId,
        status: "failed",
        message: "Workflow run not found"
      });
    }

    /*
     * 4. Get workflow organization
     */
    const workflowData = await graphql(
      `
        query GetWorkflow($id: uuid!) {
          workflows_by_pk(id: $id) {
            id
            org_id
            name
          }
        }
      `,
      {
        id: workflowRun.workflow_id
      }
    );

    const workflow =
      workflowData.workflows_by_pk;

    if (!workflow) {
      return res.status(404).json({
        id: stepRunId,
        status: "failed",
        message: "Workflow not found"
      });
    }

    /*
     * 5. Check organization membership
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
        org_id: workflow.org_id
      }
    );

    const member =
      memberData.org_members?.[0];

    if (!member) {
      return res.status(403).json({
        id: stepRunId,
        status: "failed",
        message:
          "You are not a member of this organization"
      });
    }

    /*
     * 6. Approval requires owner OR editor
     */
    if (
      member.role !== "owner" &&
      member.role !== "editor"
    ) {
      return res.status(403).json({
        id: stepRunId,
        status: "failed",
        message:
          "Only owner/editor can approve this step"
      });
    }

    /*
     * 7. Approve the step
     */
    const approvedAt =
      new Date().toISOString();

    const updateData = await graphql(
      `
        mutation ApproveStep(
          $id: uuid!
          $approved_by: uuid!
          $approved_at: timestamptz!
        ) {
          update_step_runs_by_pk(
            pk_columns: {
              id: $id
            }
            _set: {
              status: "completed"
              approved_by: $approved_by
              approved_at: $approved_at
            }
          ) {
            id
            status
            approved_by
            approved_at
          }
        }
      `,
      {
        id: stepRunId,
        approved_by: userId,
        approved_at: approvedAt
      }
    );

    const updated =
      updateData.update_step_runs_by_pk;

    if (!updated) {
      return res.status(500).json({
        id: stepRunId,
        status: "failed",
        message:
          "Failed to update approval step"
      });
    }

    /*
     * 8. Resume the workflow.
     *
     * For the current demo workflow,
     * approval is the final step.
     */
    const workflowUpdate =
      await graphql(
        `
          mutation ResumeWorkflow(
            $id: uuid!
          ) {
            update_workflow_runs_by_pk(
              pk_columns: {
                id: $id
              }
              _set: {
                status: "completed"
              }
            ) {
              id
              status
            }
          }
        `,
        {
          id: workflowRun.id
        }
      );

    const resumed =
      workflowUpdate.update_workflow_runs_by_pk;

    if (!resumed) {
      return res.status(500).json({
        id: stepRunId,
        status: "failed",
        message:
          "Step approved but workflow could not be resumed"
      });
    }

    console.log(
      "Approval successful:",
      stepRunId
    );

    return res.status(200).json({
      id: stepRunId,
      status: "completed",
      message:
        "Approval successful. Workflow resumed and completed."
    });

  } catch (error: any) {
    console.error(
      "APPROVE STEP ERROR:",
      error
    );

    return res.status(500).json({
      id: "",
      status: "failed",
      message:
        error?.message ||
        "Internal server error"
    });
  }
}
