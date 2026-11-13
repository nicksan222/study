import { materialIdSchema } from '@study/contracts/ids';

import type { AppRouterContext } from '#client/app/router-context.ts';
import { materialId, materialOptions } from '#client/features/material-library/index.ts';
import type { AppSearch } from '#client/lib/navigation/route-contract.ts';
import { sidebarOwner } from '#client/lib/study-client/sidebar-owner.queries.ts';

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
