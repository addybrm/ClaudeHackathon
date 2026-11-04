import { CreateWorkspaceForm } from "@/components/actions";
import { PageHeader, Panel } from "@/components/ui";

export const metadata = { title: "Add a restaurant · MarginOS" };

export default function OnboardingPage() {
  return (
    <div className="max-w-[560px]">
      <PageHeader title="Add a restaurant" description="Each restaurant keeps its own data, suppliers and reports." />
      <Panel>
        <CreateWorkspaceForm />
      </Panel>
    </div>
  );
}
