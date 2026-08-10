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

  const text = await response.text();

  let result: any;

  try {
    result = JSON.parse(text);
  } catch {
    throw new Error(`Invalid GraphQL response: ${text}`);
  }

  if (!response.ok || result.errors) {
    console.error("GRAPHQL ERROR:", result.errors);

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
    console.log("=================================");
    console.log("APPROVE STEP");
    console.log("BODY:", JSON.stringify(req.body));
    console.log("=================================");

    const stepRunId =
      req.body?.input?.step_run_id;

    const userId =
      req.body?.session_variables?.[
        "x-hasura-user-id"
      ];

    /*
     * 1. Validate input
     */
    if (!stepRunId) {
      return res.status(400).json({
        id: "",
        status: "error",
        message: "step_run_id is required",
      });
    }

    if (!userId) {
      return res.status(401).json({
        id: stepRunId,
        status: "error",
        message: "Authenticated user is required",
      });
    }

    /*
     * 2. Find the step run
     */
    const stepRunData = await graphql(
      `
        query GetStepRun($id: uuid!) {
          step_runs_by_pk(id: $id) {
            id
            workflow_run_id
            workflow_step_id
            status
          }
        }
      `,
      {
        id: stepRunId,
      }
    );

    const stepRun =
      stepRunData.step_runs_by_pk;

    if (!stepRun) {
      return res.status(404).json({
        id: stepRunId,
        status: "error",
        message: "Step run not found",
      });
    }

    /*
     * 3. Step must currently be paused
     */
    if (stepRun.status !== "paused") {
      return res.status(400).json({
        id: stepRunId,
        status: stepRun.status,
        message:
          `Step is not awaiting approval. Current status: ${stepRun.status}`,
      });
    }

    /*
     * 4. Find workflow run
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
        id: stepRun.workflow_run_id,
      }
    );

    const run =
      runData.workflow_runs_by_pk;

    if (!run) {
      return res.status(404).json({
        id: stepRunId,
        status: "error",
        message: "Workflow run not found",
      });
    }

    /*
     * 5. Find workflow and organization
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
        id: run.workflow_id,
      }
    );

    const workflow =
      workflowData.workflows_by_pk;

    if (!workflow) {
      return res.status(404).json({
        id: stepRunId,
        status: "error",
        message: "Workflow not found",
      });
    }

    /*
     * 6. Check organization membership
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

    const member =
      memberData.org_members?.[0];

    if (!member) {
      return res.status(403).json({
        id: stepRunId,
        status: "error",
        message:
          "You are not a member of this organization",
      });
    }

    /*
     * 7. Only owner/editor can approve
     */
    if (
      member.role !== "owner" &&
      member.role !== "editor"
    ) {
      return res.status(403).json({
        id: stepRunId,
        status: "error",
        message:
          "Only owner/editor can approve this step",
      });
    }

    /*
     * 8. Approve the paused step
     */
    const approvedAt =
      new Date().toISOString();

    const stepUpdateData = await graphql(
      `
        mutation ApproveStep(
          $id: uuid!
          $approved_by: uuid!
          $approved_at: timestamptz!
        ) {
          update_step_runs_by_pk(
            pk_columns: { id: $id }
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
        approved_at: approvedAt,
      }
    );

    const updatedStep =
      stepUpdateData.update_step_runs_by_pk;

    if (!updatedStep) {
      return res.status(404).json({
        id: stepRunId,
        status: "error",
        message: "Could not update step run",
      });
    }

    /*
     * 9. Resume workflow
     *
     * Our current Test Workflow has the
     * approval gate as its final step.
     * Therefore approval completes the run.
     */
    const workflowUpdateData = await graphql(
      `
        mutation CompleteWorkflowRun(
          $id: uuid!
        ) {
          update_workflow_runs_by_pk(
            pk_columns: { id: $id }
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
        id: run.id,
      }
    );

    const updatedRun =
      workflowUpdateData.update_workflow_runs_by_pk;

    if (!updatedRun) {
      return res.status(404).json({
        id: stepRunId,
        status: "error",
        message: "Could not resume workflow run",
      });
    }

    /*
     * 10. Success
     */
    console.log("APPROVAL SUCCESS");
    console.log("STEP:", updatedStep);
    console.log("RUN:", updatedRun);

    return res.status(200).json({
      id: stepRunId,
      status: "completed",
      message:
        `Approval successful. Workflow "${workflow.name}" completed successfully`,
    });

  } catch (error: any) {
    console.error("APPROVE STEP ERROR:", error);

    return res.status(500).json({
      id:
        req.body?.input?.step_run_id || "",
      status: "error",
      message:
        error?.message || "Approval failed",
    });
  }
}
