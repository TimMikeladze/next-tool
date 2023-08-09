import { NextRequest, NextResponse } from 'next/server.js';
import { NextApiRequest, NextApiResponse } from 'next/types';

export type NextToolRequest = {
  body?: {
    action: string;
    input: any;
  };
  headers?: Headers;
};

export type NextToolSendFn = <JsonBody>(
  body: JsonBody,
  init?: { status?: number }
) => NextResponse<JsonBody> | Promise<void>;

export type NextToolHandlerArgs = {
  request: NextToolRequest;
  send: NextToolSendFn;
};

export type NextToolStorePromise<Store> = () => Promise<Store | undefined>;

export type NextToolActionConfig = {
  after?: (input: any, request?: NextToolRequest) => Promise<any>;
  before?: (input: any, request?: NextToolRequest) => Promise<any>;
  disabled?: boolean;
};

export type NextToolConfig = {
  actions?: Record<string, NextToolActionConfig>;
};

export type NextToolActionFn<Input = any, Output = any> = (
  input: Input,
  request?: NextToolRequest
) => Promise<Output>;

export abstract class NextTool<
  Config extends NextToolConfig,
  Store = undefined,
> {
  protected store: Store | undefined;

  protected getStoreFn: NextToolStorePromise<Store>;

  protected config: Config;

  protected actionMap: Record<string, NextToolActionFn> = {};

  constructor(
    config: Config,
    store?: NextToolStorePromise<Store> | Store,
    actionMap?: Record<string, NextToolActionFn>
  ) {
    this.config = config;
    this.actionMap = actionMap || {};
    const getStoreFn = (
      store !== undefined
        ? typeof store === 'function'
          ? store
          : () => Promise.resolve(store)
        : undefined
    ) as NextToolStorePromise<Store>;
    this.getStoreFn = getStoreFn;
  }

  public static namespaceFromEnv(project?: string) {
    if (process.env.VERCEL) {
      return NextTool.namespaceFromVercel();
    }

    return [project || `localhost`, process.env.NODE_ENV]
      .filter(Boolean)
      .join(':')
      .toLowerCase();
  }

  private static namespaceFromVercel() {
    return [
      process.env.VERCEL_GIT_REPO_OWNER,
      process.env.VERCEL_GIT_REPO_SLUG,
      process.env.VERCEL_ENV,
    ]
      .join(':')
      .toLowerCase();
  }

  public getConfig() {
    return this.config;
  }

  public getStore() {
    return this.store;
  }

  public async init() {
    if (!this.store && this.getStoreFn) {
      this.store = await this.getStoreFn?.();
    }
  }

  public async handler(request: NextRequest) {
    const body = await request.json();

    return this.rawHandler({
      send: NextResponse.json,
      request: {
        body,
        headers: request.headers,
      },
    });
  }

  public async pagesApiHandler(
    request: NextApiRequest,
    response: NextApiResponse
  ) {
    const { body, headers } = request;

    const json = async (data: any, options?: { status?: number }) =>
      response.status(options?.status || 200).json(data);

    return this.rawHandler({
      send: json,
      request: {
        body,
        headers: headers as any,
      },
    });
  }

  public async rawHandler(args: NextToolHandlerArgs) {
    const { send, request } = args;

    if (!request.body) {
      return send({ error: `No body` }, { status: 400 });
    }

    const { action, input } = request.body;

    if (!action) {
      return send({ error: `No action` }, { status: 400 });
    }

    const actionFn = this.actionMap[action];

    if (!actionFn) {
      return send({ error: `Unknown action "${action}"` }, { status: 400 });
    }

    const enabledActions = this.config.actions;

    if (!enabledActions) {
      return send({ error: `Action "${action}" not enabled` }, { status: 400 });
    }

    const actionConfig = enabledActions[action];

    if (!actionConfig || actionConfig.disabled) {
      return send({ error: `Action "${action}" not enabled` }, { status: 400 });
    }

    await this.init();

    try {
      const before = actionConfig.before
        ? await actionConfig.before(input, request)
        : input;

      const res = await actionFn(before, request);

      const data = actionConfig.after
        ? await actionConfig.after(res, request)
        : res;

      return send({ data });
    } catch (error) {
      console.error(error);
      return send({ error: (error as any).message }, { status: 500 });
    }
  }
}
