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
    throw new Error(`GraphQL returned invalid JSON: ${text}`);
  }

  if (!response.ok || result.errors) {
    console.error("GRAPHQL ERROR:", result.errors);

    throw new Error(
      result.errors?.[0]?.message ||
        `GraphQL request failed: ${response.status}`
    );
  }

  return result.data;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runHttpRequest() {
  let lastError: any;

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const response = await fetch("https://jsonplaceholder.typicode.com/todos/1");

      if (!response.ok) {
        throw new Error(`HTTP request failed: ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      lastError = error;

      if (attempt < 2) {
        await sleep(500);
      }
    }
  }

  throw lastError;
}

async function runLlmCall() {
  /*
   * Assignment allows a disclosed stub if an LLM API
   * is not available.
   *
   * This stub intentionally returns "yes" so that the
   * conditional branch reaches the approval gate.
   */
  await sleep(1000);

  return {
    text: "yes",
    source: "disclosed-demo-stub",
  };
}

export default async function handler(
  req: Request,
  res: Response
) {
  try {
    console.log("=================================");
    console.log("TRIGGER WORKFLOW RUN");
    console.log("BODY:", JSON.stringify(req.body));
    console.log("=================================");

    const workflowId = req.body?.input?.workflow_id;

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
     * Get workflow.
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
     * Check organization membership.
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
        message:
          "User is not a member of this organization",
      });
    }

    /*
     * STEP 3
     * Owner/editor can run.
     */
    if (
      member.role !== "owner" &&
      member.role !== "editor"
    ) {
      return res.status(403).json({
        message:
          "Only owner/editor can run workflows",
      });
    }

    /*
     * STEP 4
     * Get workflow steps in order.
     */
    const stepsData = await graphql(
      `
        query GetWorkflowSteps($workflow_id: uuid!) {
          workflow_steps(
            where: {
              workflow_id: { _eq: $workflow_id }
            }
            order_by: {
              step_order: asc
            }
          ) {
            id
            workflow_id
            step_order
            name
            type
            config
          }
        }
      `,
      {
        workflow_id: workflowId,
      }
    );

    const steps = stepsData.workflow_steps || [];

    if (steps.length === 0) {
      return res.status(400).json({
        message: "Workflow has no steps",
      });
    }

    /*
     * STEP 5
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

    const run =
      runData.insert_workflow_runs_one;

    console.log("WORKFLOW RUN:", run.id);

    /*
     * Previous step output.
     */
    let previousOutput: any = null;

    /*
     * STEP 6
     * Execute steps sequentially.
     */
    for (const step of steps) {
      console.log(
        `Executing step ${step.step_order}: ${step.type}`
      );

      /*
       * Create step_run.
       */
      const stepRunData = await graphql(
        `
          mutation CreateStepRun(
            $workflow_run_id: uuid!
            $workflow_step_id: uuid!
            $status: String!
            $input: jsonb
            $attempt_count: Int!
          ) {
            insert_step_runs_one(
              object: {
                workflow_run_id: $workflow_run_id
                workflow_step_id: $workflow_step_id
                status: $status
                input: $input
                attempt_count: $attempt_count
              }
            ) {
              id
              status
            }
          }
        `,
        {
          workflow_run_id: run.id,
          workflow_step_id: step.id,
          status: "running",
          input: previousOutput,
          attempt_count: 1,
        }
      );

      const stepRun =
        stepRunData.insert_step_runs_one;

      try {
        let output: any;

        /*
         * LLM
         */
        if (step.type === "llm_call") {
          output = await runLlmCall();
        }

        /*
         * HTTP
         */
        else if (step.type === "http_request") {
          output = await runHttpRequest();
        }

        /*
         * CONDITIONAL
         */
        else if (
          step.type === "conditional_branch"
        ) {
          const text =
            typeof previousOutput === "string"
              ? previousOutput
              : previousOutput?.text || "";

          const condition =
            String(text).toLowerCase().includes("yes");

          output = {
            condition,
            branch: condition
              ? "approval"
              : "complete",
          };
        }

    /*
     * DB WRITE
     */
    else if (step.type === "db_write") {
      const resultKey =
        step.config?.result_key ||
        step.name ||
        "workflow_result";

      await graphql(
        `
          mutation SaveWorkflowResult(
            $org_id: uuid!
            $workflow_id: uuid!
            $workflow_run_id: uuid!
            $result_key: String!
            $result_value: jsonb!
          ) {
            insert_workflow_results_one(
              object: {
                org_id: $org_id
                workflow_id: $workflow_id
                workflow_run_id: $workflow_run_id
                result_key: $result_key
                result_value: $result_value
              }
            ) {
              id
              result_key
              result_value
            }
          }
        `,
        {
          org_id: workflow.org_id,
          workflow_id: workflow.id,
          workflow_run_id: run.id,
          result_key: resultKey,
          result_value: previousOutput,
        }
      );

      output = {
        saved: true,
        result_key: resultKey,
        result_value: previousOutput,
      };
    }

        /*
         * APPROVAL
         */
        else if (
          step.type === "approval_gate"
        ) {
          await graphql(
            `
              mutation PauseStep(
                $id: uuid!
                $status: String!
              ) {
                update_step_runs_by_pk(
                  pk_columns: { id: $id }
                  _set: {
                    status: $status
                  }
                ) {
                  id
                  status
                }
              }
            `,
            {
              id: stepRun.id,
              status: "paused",
            }
          );

          await graphql(
            `
              mutation PauseWorkflow(
                $id: uuid!
                $status: String!
              ) {
                update_workflow_runs_by_pk(
                  pk_columns: { id: $id }
                  _set: {
                    status: $status
                  }
                ) {
                  id
                  status
                }
              }
            `,
            {
              id: run.id,
              status: "paused",
            }
          );

          return res.status(200).json({
            id: run.id,
            status: "paused",
            message:
              `Workflow "${workflow.name}" is paused awaiting approval`,
          });
        }

        /*
         * Unknown step type
         */
        else {
          throw new Error(
            `Unsupported step type: ${step.type}`
          );
        }

        /*
         * Save successful step.
         */
        await graphql(
          `
            mutation CompleteStep(
              $id: uuid!
              $status: String!
              $output: jsonb
            ) {
              update_step_runs_by_pk(
                pk_columns: { id: $id }
                _set: {
                  status: $status
                  output: $output
                }
              ) {
                id
                status
              }
            }
          `,
          {
            id: stepRun.id,
            status: "completed",
            output,
          }
        );

        previousOutput = output;
      } catch (stepError: any) {
        console.error(
          `STEP ${step.step_order} FAILED:`,
          stepError
        );

        await graphql(
          `
            mutation FailStep(
              $id: uuid!
              $status: String!
              $error: String!
            ) {
              update_step_runs_by_pk(
                pk_columns: { id: $id }
                _set: {
                  status: $status
                  error: $error
                }
              ) {
                id
                status
              }
            }
          `,
          {
            id: stepRun.id,
            status: "failed",
            error:
              stepError.message ||
              "Step execution failed",
          }
        );

        await graphql(
          `
            mutation FailWorkflow(
              $id: uuid!
              $status: String!
            ) {
              update_workflow_runs_by_pk(
                pk_columns: { id: $id }
                _set: {
                  status: $status
                }
              ) {
                id
                status
              }
            }
          `,
          {
            id: run.id,
            status: "failed",
          }
        );

        return res.status(500).json({
          id: run.id,
          status: "failed",
          message:
            stepError.message ||
            "Workflow execution failed",
        });
      }
    }

    /*
     * All steps completed.
     */
    await graphql(
      `
        mutation CompleteWorkflow(
          $id: uuid!
          $status: String!
        ) {
          update_workflow_runs_by_pk(
            pk_columns: { id: $id }
            _set: {
              status: $status
            }
          ) {
            id
            status
          }
        }
      `,
      {
        id: run.id,
        status: "completed",
      }
    );

    return res.status(200).json({
      id: run.id,
      status: "completed",
      message:
        `Workflow "${workflow.name}" completed successfully`,
    });
  } catch (error: any) {
    console.error(
      "TRIGGER WORKFLOW ERROR:",
      error
    );

    return res.status(500).json({
      message:
        error.message ||
        "Workflow execution failed",
    });
  }
}
