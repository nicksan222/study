import { materialIdSchema } from '@study/contracts/ids';

import type { AppRouterContext } from '#web/app/router-context.ts';
import { materialId, materialOptions } from '#web/features/material-library/index.ts';
import type { AppSearch } from '#web/lib/navigation/route-contract.ts';
import { sidebarOwner } from '#web/lib/study-client/sidebar-owner.queries.ts';

export const materialSidebar = {
  owner: sidebarOwner(materialIdSchema, (params) => params.materialId, materialOptions)
};

export const validateMaterialParams = ({ params }: { params: { materialId: string } }) => {
  materialId(params.materialId);
};

export const materialLoaderDeps = ({ search }: { search: AppSearch }) => ({
  version: search.version,
  attempt: search.attempt
});

export const loadMaterial = ({
  context,
  params
}: {
  context: AppRouterContext;
  params: { materialId: string };
}) => context.queryClient.ensureQueryData(materialOptions(materialId(params.materialId)));
